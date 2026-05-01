// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MendelAgent} from "../src/MendelAgent.sol";
import {MendelBreeder} from "../src/MendelBreeder.sol";

/**
 * Round-trip the EIP-712 fulfillment path with a known requester key.
 */
contract MendelBreederTest is Test {
    MendelAgent agent;
    MendelBreeder breeder;

    uint256 constant REQUESTER_PK = 0xA11CE;
    uint256 constant ATTACKER_PK = 0xBADC0DE;
    address requester;
    address attacker;

    bytes32 constant LINEAGE = keccak256("mendel/eth-usdc-1h");

    function setUp() public {
        requester = vm.addr(REQUESTER_PK);
        attacker = vm.addr(ATTACKER_PK);

        agent = new MendelAgent(address(this));
        breeder = new MendelBreeder(address(agent));
        agent.setBreeder(address(breeder));

        // Mint two founders with the same lineage from the requester.
        vm.startPrank(requester);
        agent.mintFounder(
            requester,
            "0g://A",
            keccak256("metaA"),
            keccak256("blobA"),
            keccak256(abi.encode(requester, uint256(1))),
            LINEAGE
        );
        agent.mintFounder(
            requester,
            "0g://B",
            keccak256("metaB"),
            keccak256("blobB"),
            keccak256(abi.encode(requester, uint256(2))),
            LINEAGE
        );
        vm.stopPrank();
    }

    // ----- Helpers ------------------------------------------------------

    function _samplePayload()
        internal
        pure
        returns (
            string[] memory uris,
            bytes32[] memory blobs,
            bytes32[] memory metas,
            bytes32[] memory keys
        )
    {
        uris = new string[](2);
        uris[0] = "0g://child1";
        uris[1] = "0g://child2";
        blobs = new bytes32[](2);
        blobs[0] = keccak256("c1blob");
        blobs[1] = keccak256("c2blob");
        metas = new bytes32[](2);
        metas[0] = keccak256("c1meta");
        metas[1] = keccak256("c2meta");
        keys = new bytes32[](2);
        keys[0] = keccak256("c1key");
        keys[1] = keccak256("c2key");
    }

    function _digest(
        uint256 requestId,
        string[] memory uris,
        bytes32[] memory blobs,
        bytes32[] memory metas,
        bytes32[] memory keys
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                breeder.FULFILLMENT_TYPEHASH(),
                requestId,
                keccak256(abi.encode(uris)),
                keccak256(abi.encodePacked(blobs)),
                keccak256(abi.encodePacked(metas)),
                keccak256(abi.encodePacked(keys))
            )
        );
        return
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    breeder.DOMAIN_SEPARATOR(),
                    structHash
                )
            );
    }

    function _sign(
        uint256 pk,
        bytes32 digest
    ) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ----- Tests --------------------------------------------------------

    function test_FulfillWithValidSignature() public {
        vm.prank(requester);
        uint256 requestId = breeder.breed(1, 2, keccak256("auth"));
        assertEq(requestId, 1);

        (
            string[] memory uris,
            bytes32[] memory blobs,
            bytes32[] memory metas,
            bytes32[] memory keys
        ) = _samplePayload();

        bytes memory sig = _sign(
            REQUESTER_PK,
            _digest(requestId, uris, blobs, metas, keys)
        );

        uint256[] memory childIds = breeder.fulfillBreeding(
            requestId,
            uris,
            blobs,
            metas,
            keys,
            sig
        );

        assertEq(childIds.length, 2);
        assertEq(agent.ownerOf(childIds[0]), requester);
        assertEq(agent.ownerOf(childIds[1]), requester);
        assertEq(agent.generation(childIds[0]), 1);
        assertEq(agent.generation(childIds[1]), 1);
        assertEq(agent.lineageHash(childIds[0]), LINEAGE);
        (uint256 pA, uint256 pB) = agent.parents(childIds[0]);
        assertEq(pA, 1);
        assertEq(pB, 2);
        assertEq(agent.encryptedURIs(childIds[0]), "0g://child1");
        assertEq(agent.blobHashes(childIds[1]), keccak256("c2blob"));

        // Refulfill should now revert
        vm.expectRevert(MendelBreeder.AlreadyFulfilled.selector);
        breeder.fulfillBreeding(requestId, uris, blobs, metas, keys, sig);
    }

    function test_RejectWrongSigner() public {
        vm.prank(requester);
        uint256 requestId = breeder.breed(1, 2, keccak256("auth"));

        (
            string[] memory uris,
            bytes32[] memory blobs,
            bytes32[] memory metas,
            bytes32[] memory keys
        ) = _samplePayload();

        bytes memory sig = _sign(
            ATTACKER_PK,
            _digest(requestId, uris, blobs, metas, keys)
        );

        vm.expectRevert(MendelBreeder.InvalidSignature.selector);
        breeder.fulfillBreeding(requestId, uris, blobs, metas, keys, sig);
    }

    function test_RejectMutatedPayload() public {
        vm.prank(requester);
        uint256 requestId = breeder.breed(1, 2, keccak256("auth"));

        (
            string[] memory uris,
            bytes32[] memory blobs,
            bytes32[] memory metas,
            bytes32[] memory keys
        ) = _samplePayload();

        bytes memory sig = _sign(
            REQUESTER_PK,
            _digest(requestId, uris, blobs, metas, keys)
        );

        // Tamper with one URI after signing
        uris[1] = "0g://attacker";

        vm.expectRevert(MendelBreeder.InvalidSignature.selector);
        breeder.fulfillBreeding(requestId, uris, blobs, metas, keys, sig);
    }

    function test_RejectSameToken() public {
        vm.prank(requester);
        vm.expectRevert(MendelBreeder.SameToken.selector);
        breeder.breed(1, 1, keccak256("auth"));
    }

    function test_RejectLineageMismatch() public {
        // Mint a third token with a different lineage
        vm.prank(requester);
        agent.mintFounder(
            requester,
            "0g://C",
            keccak256("metaC"),
            keccak256("blobC"),
            keccak256(abi.encode(requester, uint256(3))),
            keccak256("other-lineage")
        );

        vm.prank(requester);
        vm.expectRevert(MendelBreeder.LineageMismatch.selector);
        breeder.breed(1, 3, keccak256("auth"));
    }

    function test_RejectLengthMismatch() public {
        vm.prank(requester);
        uint256 requestId = breeder.breed(1, 2, keccak256("auth"));

        string[] memory uris = new string[](2);
        uris[0] = "0g://x";
        uris[1] = "0g://y";
        bytes32[] memory blobs = new bytes32[](1); // wrong length
        blobs[0] = keccak256("b");
        bytes32[] memory metas = new bytes32[](2);
        bytes32[] memory keys = new bytes32[](2);

        // Sig won't matter — length check fires first; but provide a real one.
        bytes memory sig = _sign(REQUESTER_PK, bytes32(0));

        vm.expectRevert(MendelBreeder.LengthMismatch.selector);
        breeder.fulfillBreeding(requestId, uris, blobs, metas, keys, sig);
    }

    function test_RejectNoChildren() public {
        vm.prank(requester);
        uint256 requestId = breeder.breed(1, 2, keccak256("auth"));

        string[] memory uris = new string[](0);
        bytes32[] memory blobs = new bytes32[](0);
        bytes32[] memory metas = new bytes32[](0);
        bytes32[] memory keys = new bytes32[](0);
        bytes memory sig = _sign(REQUESTER_PK, bytes32(0));

        vm.expectRevert(MendelBreeder.NoChildren.selector);
        breeder.fulfillBreeding(requestId, uris, blobs, metas, keys, sig);
    }

    function test_BreederLinkedOnAgent() public view {
        assertEq(agent.breeder(), address(breeder));
    }

    function test_DomainSeparatorIsCorrect() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Mendel")),
                keccak256(bytes("1")),
                block.chainid,
                address(breeder)
            )
        );
        assertEq(breeder.DOMAIN_SEPARATOR(), expected);
    }
}
