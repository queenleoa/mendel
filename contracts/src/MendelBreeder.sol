// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "openzeppelin-contracts/access/Ownable.sol";
import {ECDSA} from "openzeppelin-contracts/utils/cryptography/ECDSA.sol";
import {IMendelAgent} from "./IMendelAgent.sol";

/**
 * @title MendelBreeder
 * @notice Permissionless breeding entry point for MendelAgent iNFTs.
 *
 * v1 design notes:
 *   - `breed()` is open: any caller can request breeding for any two
 *     existing tokens that share a lineage. No oracle role.
 *   - Recombination runs off-chain (in the requester's browser, in the
 *     v1 implementation) and the result is committed back via
 *     `fulfillBreeding()`, gated by an EIP-712 signature from the
 *     original requester. No second party / oracle is involved.
 *   - The seed mixed into the request includes the previous block's
 *     hash so the requester can't pre-compute the recombination
 *     outcome before submitting the breed tx.
 *   - `royaltyRecipient` is always passed as `address(0)`; the v2
 *     cross-owner upgrade will source it from a counterparty signature.
 */
contract MendelBreeder is Ownable {
    // =====================================================================
    //                                State
    // =====================================================================

    IMendelAgent public immutable agent;
    uint256 public requestCounter;

    string public constant DOMAIN_NAME = "Mendel";
    string public constant DOMAIN_VERSION = "1";
    bytes32 public DOMAIN_SEPARATOR;

    bytes32 public constant FULFILLMENT_TYPEHASH =
        keccak256(
            "BreedingFulfillment(uint256 requestId,bytes32 encryptedURIsHash,bytes32 blobHashesHash,bytes32 metadataHashesHash,bytes32 keyCommitmentsHash)"
        );

    struct BreedingRequest {
        uint256 parentA;
        uint256 parentB;
        address requester;
        bytes32 authHash;
        bytes32 seed;
        bool fulfilled;
    }

    mapping(uint256 => BreedingRequest) public requests;

    // =====================================================================
    //                                Events
    // =====================================================================

    event BreedingRequested(
        uint256 indexed requestId,
        uint256 indexed parentA,
        uint256 indexed parentB,
        address requester,
        bytes32 seed
    );
    event BreedingFulfilled(uint256 indexed requestId, uint256[] childTokenIds);

    // =====================================================================
    //                                Errors
    // =====================================================================

    error SameToken();
    error LineageMismatch();
    error AlreadyFulfilled();
    error NoChildren();
    error LengthMismatch();
    error InvalidSignature();

    // =====================================================================
    //                             Constructor
    // =====================================================================

    constructor(address _agent) Ownable(msg.sender) {
        agent = IMendelAgent(_agent);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    // =====================================================================
    //                             Breed request
    // =====================================================================

    /**
     * @notice Open a breeding request for two existing tokens of the same
     *         lineage. Caller becomes the requester and is the only address
     *         whose signature can later fulfill this request.
     */
    function breed(
        uint256 parentA,
        uint256 parentB,
        bytes32 authHash
    ) external returns (uint256 requestId) {
        if (parentA == parentB) revert SameToken();
        // OZ ERC-721 `ownerOf` reverts on non-existent tokens, which
        // gives us the existence check for free.
        agent.ownerOf(parentA);
        agent.ownerOf(parentB);
        if (agent.lineageHash(parentA) != agent.lineageHash(parentB)) {
            revert LineageMismatch();
        }

        requestId = ++requestCounter;

        bytes32 seed = keccak256(
            abi.encode(
                requestId,
                agent.blobHashes(parentA),
                agent.blobHashes(parentB),
                blockhash(block.number - 1)
            )
        );

        requests[requestId] = BreedingRequest({
            parentA: parentA,
            parentB: parentB,
            requester: msg.sender,
            authHash: authHash,
            seed: seed,
            fulfilled: false
        });

        emit BreedingRequested(requestId, parentA, parentB, msg.sender, seed);
    }

    // =====================================================================
    //                          Fulfill (sig-gated)
    // =====================================================================

    /**
     * @notice Submit the off-chain-computed children for a breed request.
     *         The requester's EIP-712 signature over
     *         `BreedingFulfillment(requestId, hashes…)` is required.
     */
    function fulfillBreeding(
        uint256 requestId,
        string[] calldata encryptedURIs,
        bytes32[] calldata blobHashes,
        bytes32[] calldata metadataHashes,
        bytes32[] calldata keyCommitments,
        bytes calldata signature
    ) external returns (uint256[] memory childIds) {
        BreedingRequest storage req = requests[requestId];
        if (req.fulfilled) revert AlreadyFulfilled();

        uint256 n = encryptedURIs.length;
        if (n == 0) revert NoChildren();
        if (
            blobHashes.length != n ||
            metadataHashes.length != n ||
            keyCommitments.length != n
        ) revert LengthMismatch();

        bytes32 structHash = keccak256(
            abi.encode(
                FULFILLMENT_TYPEHASH,
                requestId,
                keccak256(abi.encode(encryptedURIs)),
                keccak256(abi.encodePacked(blobHashes)),
                keccak256(abi.encodePacked(metadataHashes)),
                keccak256(abi.encodePacked(keyCommitments))
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != req.requester) revert InvalidSignature();

        // Effects before interactions: flip the fulfilled flag now so a
        // malicious ERC-721 receiver cannot re-enter.
        req.fulfilled = true;

        childIds = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            childIds[i] = agent.mintChild(
                req.requester,
                encryptedURIs[i],
                metadataHashes[i],
                blobHashes[i],
                keyCommitments[i],
                req.parentA,
                req.parentB,
                address(0)
            );
        }

        emit BreedingFulfilled(requestId, childIds);
    }
}
