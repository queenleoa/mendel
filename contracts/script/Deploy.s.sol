// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2 as console} from "forge-std/Script.sol";
import {MendelAgent} from "../src/MendelAgent.sol";
import {MendelBreeder} from "../src/MendelBreeder.sol";

/**
 * @notice Fresh deployment of MendelAgent + MendelBreeder, wiring the
 *         breeder onto the agent. The deployer becomes both contracts'
 *         Ownable owner.
 *
 * Usage (set PRIVATE_KEY in .env or pass --private-key):
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url galileo --broadcast --verify
 *
 * If you want to attach a breeder to an existing agent, set
 * MENDEL_AGENT_ADDRESS in your env and use the DeployBreeder script.
 */
contract Deploy is Script {
    function run()
        external
        returns (MendelAgent agent, MendelBreeder breeder)
    {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);

        vm.startBroadcast(pk);

        agent = new MendelAgent(deployer);
        console.log("MendelAgent:", address(agent));

        breeder = new MendelBreeder(address(agent));
        console.log("MendelBreeder:", address(breeder));

        agent.setBreeder(address(breeder));
        console.log("setBreeder() called on agent.");

        vm.stopBroadcast();

        console.log("");
        console.log("Add to frontend/.env.local:");
        console.log("VITE_MENDEL_AGENT_ADDRESS=", address(agent));
        console.log("VITE_MENDEL_BREEDER_ADDRESS=", address(breeder));
    }
}

/**
 * @notice Deploy only the breeder, attaching to an existing MendelAgent.
 *         Caller must be the agent's Ownable owner so `setBreeder` succeeds.
 *
 *   MENDEL_AGENT_ADDRESS=0x... forge script script/Deploy.s.sol:DeployBreeder \
 *     --rpc-url galileo --broadcast --verify
 */
contract DeployBreeder is Script {
    function run() external returns (MendelBreeder breeder) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address agentAddress = vm.envAddress("MENDEL_AGENT_ADDRESS");
        console.log("Agent:", agentAddress);

        vm.startBroadcast(pk);

        breeder = new MendelBreeder(agentAddress);
        console.log("MendelBreeder:", address(breeder));

        MendelAgent(agentAddress).setBreeder(address(breeder));
        console.log("setBreeder() called.");

        vm.stopBroadcast();

        console.log("");
        console.log("Add to frontend/.env.local:");
        console.log("VITE_MENDEL_BREEDER_ADDRESS=", address(breeder));
    }
}
