// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IMendelAgent
 * @notice Minimal view of MendelAgent that the breeder needs.
 *         Mirrors only the surface used by MendelBreeder so the breeder
 *         contract can be unit-tested without pulling the full ERC721
 *         implementation into its dependency graph.
 */
interface IMendelAgent {
    function ownerOf(uint256 tokenId) external view returns (address);

    function lineageHash(uint256 tokenId) external view returns (bytes32);

    function blobHashes(uint256 tokenId) external view returns (bytes32);

    function mintChild(
        address to,
        string calldata encryptedURI,
        bytes32 metadataHash,
        bytes32 blobHash,
        bytes32 keyCommitment,
        uint256 parentA,
        uint256 parentB,
        address royaltyRecipient
    ) external returns (uint256 tokenId);
}
