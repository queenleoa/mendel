// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "openzeppelin-contracts/token/ERC721/ERC721.sol";
import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/utils/ReentrancyGuard.sol";

/**
 * @title MendelAgent
 * @notice ERC-721 + ERC-7857-style iNFT for Mendel quant strategies. Each
 *         token references an encrypted genome blob on 0G Storage, plus
 *         lineage and live fitness telemetry.
 *
 * v1 design notes (locked spec):
 *   - Genome encryption keys are derived from the owner's wallet signature
 *     off-chain. The contract stores commitments only — never plaintext.
 *   - Founders are permissionless to mint. Children are gated to a single
 *     authorized breeder address (the MendelBreeder contract), set by the
 *     contract owner.
 *   - Fitness updates are gated to a single fitness-updater address. The
 *     `signature` argument is stored without validation in v1; v2 will
 *     verify it as a TEE/ZK attestation over `(tokenId, fitnessBps,
 *     tradeCount)`.
 *   - ERC-7857's sealed-key transfer / clone / authorizeUsage operations
 *     are intentionally NOT implemented in v1. Standard ERC-721 transfers
 *     are inherited and will leave the genome unreadable to a new owner;
 *     v2 adds re-encryption.
 *   - `royaltyRecipient` is reserved for v2 cross-owner breeding; v1
 *     always sets it to address(0).
 */
contract MendelAgent is ERC721, Ownable, ReentrancyGuard {
    // =====================================================================
    //                                State
    // =====================================================================

    /// Monotonic token id counter. First minted token is id 1; id 0 is
    /// reserved as the "no parent" sentinel for founders.
    uint256 private _nextTokenId = 1;

    /// Address authorized to call `mintChild` (the MendelBreeder contract).
    address public breeder;

    /// Address authorized to call `updateFitness` (off-chain fitness service).
    address public fitnessUpdater;

    // ---- Encrypted asset references (per ERC-7857 storage shape) ----

    /// `0g://{rootHash}` pointing at the encrypted genome blob on 0G Storage.
    mapping(uint256 => string) public encryptedURIs;

    /// keccak256(sealedKey) — commitment to the genome encryption key.
    mapping(uint256 => bytes32) public metadataHashes;

    /// keccak256(encryptedBlob) — storage integrity check against the URI.
    mapping(uint256 => bytes32) public blobHashes;

    /// keccak256(abi.encode(owner, tokenId)) — public commitment to the
    /// key-derivation input for off-chain verification.
    mapping(uint256 => bytes32) public keyCommitments;

    // ---- Lineage ----

    /// [parentA, parentB] token ids. (0, 0) for founders.
    mapping(uint256 => uint256[2]) private _parents;

    /// Strategy family identity. Children inherit their parents' lineage.
    /// `mintChild` rejects parents whose lineage hashes differ.
    mapping(uint256 => bytes32) public lineageHash;

    /// 0 for founders, max(parents.generation) + 1 for children.
    mapping(uint256 => uint8) public generation;

    /// v2 cross-owner royalty target. address(0) in v1.
    mapping(uint256 => address) public royaltyRecipient;

    // ---- Fitness telemetry ----

    /// Signed basis points of return (e.g. 10_000 = +100%, -10_000 = -100%).
    mapping(uint256 => int256) public currentFitness;

    /// Cumulative trades executed by the strategy at this token.
    mapping(uint256 => uint256) public tradesExecuted;

    /// Block timestamp of the most recent `updateFitness` call.
    mapping(uint256 => uint256) public lastUpdated;

    /// Last signature submitted with `updateFitness`. Stored only in v1;
    /// v2 will verify against an off-chain attestation.
    mapping(uint256 => bytes) public lastFitnessSignature;

    // =====================================================================
    //                                Events
    // =====================================================================

    event FounderMinted(
        uint256 indexed tokenId,
        address indexed owner,
        bytes32 indexed lineageHash
    );
    event ChildMinted(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 parentA,
        uint256 parentB,
        bytes32 lineageHash,
        uint8 generation
    );
    event FitnessUpdated(
        uint256 indexed tokenId,
        int256 fitnessBps,
        uint256 tradesExecuted,
        uint256 timestamp
    );
    event BreederUpdated(address indexed previousBreeder, address indexed newBreeder);
    event FitnessUpdaterUpdated(
        address indexed previousUpdater,
        address indexed newUpdater
    );

    // =====================================================================
    //                                Errors
    // =====================================================================

    error NotBreeder();
    error NotFitnessUpdater();
    error LineageMismatch(bytes32 expected, bytes32 actual);
    error ZeroAddress();
    error EmptyEncryptedURI();

    // =====================================================================
    //                              Modifiers
    // =====================================================================

    modifier onlyBreeder() {
        if (msg.sender != breeder) revert NotBreeder();
        _;
    }

    modifier onlyFitnessUpdater() {
        if (msg.sender != fitnessUpdater) revert NotFitnessUpdater();
        _;
    }

    // =====================================================================
    //                             Constructor
    // =====================================================================

    constructor(address initialOwner)
        ERC721("Mendel Agent", "MENDEL")
        Ownable(initialOwner)
    {}

    // =====================================================================
    //                               Minting
    // =====================================================================

    /**
     * @notice Mint a founder iNFT. Permissionless — `msg.sender` pays gas;
     *         `to` receives the token.
     * @return tokenId The newly minted token id.
     */
    function mintFounder(
        address to,
        string calldata encryptedURI,
        bytes32 metadataHash,
        bytes32 blobHash,
        bytes32 keyCommitment,
        bytes32 _lineageHash
    ) external nonReentrant returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (bytes(encryptedURI).length == 0) revert EmptyEncryptedURI();

        tokenId = _nextTokenId++;

        encryptedURIs[tokenId] = encryptedURI;
        metadataHashes[tokenId] = metadataHash;
        blobHashes[tokenId] = blobHash;
        keyCommitments[tokenId] = keyCommitment;
        lineageHash[tokenId] = _lineageHash;
        // _parents, generation, royaltyRecipient default to zero values.

        _safeMint(to, tokenId);

        emit FounderMinted(tokenId, to, _lineageHash);
    }

    /**
     * @notice Mint a child iNFT from two existing parents. Restricted to
     *         the authorized breeder address.
     * @dev Reverts if either parent does not exist or if the parents have
     *      different lineage hashes. Generation is `max(genA, genB) + 1`.
     */
    function mintChild(
        address to,
        string calldata encryptedURI,
        bytes32 metadataHash,
        bytes32 blobHash,
        bytes32 keyCommitment,
        uint256 parentA,
        uint256 parentB,
        address _royaltyRecipient
    ) external onlyBreeder nonReentrant returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (bytes(encryptedURI).length == 0) revert EmptyEncryptedURI();

        // Both calls revert with ERC721NonexistentToken if missing.
        _requireOwned(parentA);
        _requireOwned(parentB);

        bytes32 lineage = lineageHash[parentA];
        bytes32 lineageB = lineageHash[parentB];
        if (lineage != lineageB) revert LineageMismatch(lineage, lineageB);

        uint8 genA = generation[parentA];
        uint8 genB = generation[parentB];
        uint8 childGen = (genA >= genB ? genA : genB) + 1;

        tokenId = _nextTokenId++;

        encryptedURIs[tokenId] = encryptedURI;
        metadataHashes[tokenId] = metadataHash;
        blobHashes[tokenId] = blobHash;
        keyCommitments[tokenId] = keyCommitment;
        _parents[tokenId][0] = parentA;
        _parents[tokenId][1] = parentB;
        lineageHash[tokenId] = lineage;
        generation[tokenId] = childGen;
        royaltyRecipient[tokenId] = _royaltyRecipient;

        _safeMint(to, tokenId);

        emit ChildMinted(tokenId, to, parentA, parentB, lineage, childGen);
    }

    // =====================================================================
    //                               Fitness
    // =====================================================================

    /**
     * @notice Record fitness telemetry for a token.
     * @dev v1 stores `signature` without validating it. v2 will recover the
     *      signer and check it against an attested TEE/ZK identity.
     */
    function updateFitness(
        uint256 tokenId,
        int256 fitnessBps,
        uint256 tradeCount,
        bytes calldata signature
    ) external onlyFitnessUpdater {
        _requireOwned(tokenId);

        currentFitness[tokenId] = fitnessBps;
        tradesExecuted[tokenId] = tradeCount;
        lastUpdated[tokenId] = block.timestamp;
        lastFitnessSignature[tokenId] = signature;

        emit FitnessUpdated(tokenId, fitnessBps, tradeCount, block.timestamp);
    }

    // =====================================================================
    //                                Admin
    // =====================================================================

    function setBreeder(address newBreeder) external onlyOwner {
        emit BreederUpdated(breeder, newBreeder);
        breeder = newBreeder;
    }

    function setFitnessUpdater(address newUpdater) external onlyOwner {
        emit FitnessUpdaterUpdated(fitnessUpdater, newUpdater);
        fitnessUpdater = newUpdater;
    }

    // =====================================================================
    //                                Views
    // =====================================================================

    /// @return parentA First parent token id (0 for founders).
    /// @return parentB Second parent token id (0 for founders).
    function parents(uint256 tokenId)
        external
        view
        returns (uint256 parentA, uint256 parentB)
    {
        return (_parents[tokenId][0], _parents[tokenId][1]);
    }

    /// @return The total number of tokens ever minted.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
