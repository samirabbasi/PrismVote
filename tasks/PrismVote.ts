import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

/**
 * Example:
 *   - npx hardhat --network sepolia task:address
 */
task("task:address", "Prints the PrismVote address").setAction(async function (_taskArguments: TaskArguments, hre) {
  const { deployments } = hre;

  const prismVote = await deployments.get("PrismVote");

  console.log("PrismVote address is " + prismVote.address);
});

/**
 * Example:
 *   - npx hardhat --network sepolia task:create-poll --title "City Budget" --options "Parks,Transit" --start 1710000000 --end 1710003600
 */
task("task:create-poll", "Creates a new poll")
  .addParam("title", "Poll title")
  .addParam("options", "Comma-separated options (2-4)")
  .addParam("start", "Start time (unix seconds)")
  .addParam("end", "End time (unix seconds)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const options = taskArguments.options.split(",").map((value: string) => value.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 4) {
      throw new Error("Options must contain 2-4 values.");
    }

    const startTime = BigInt(taskArguments.start);
    const endTime = BigInt(taskArguments.end);

    const prismVoteDeployment = await deployments.get("PrismVote");
    const prismVote = await ethers.getContractAt("PrismVote", prismVoteDeployment.address);

    const [deployer] = await ethers.getSigners();

    const tx = await prismVote
      .connect(deployer)
      .createPoll(taskArguments.title, options, startTime, endTime);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

/**
 * Example:
 *   - npx hardhat --network sepolia task:vote --poll-id 0 --option 1
 */
task("task:vote", "Votes on a poll using encrypted input")
  .addParam("pollId", "Poll id")
  .addParam("option", "Option index (0-based)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const optionIndex = parseInt(taskArguments.option);
    if (!Number.isInteger(optionIndex) || optionIndex < 0) {
      throw new Error(`Argument --option must be a non-negative integer`);
    }

    await fhevm.initializeCLIApi();

    const prismVoteDeployment = await deployments.get("PrismVote");
    const prismVote = await ethers.getContractAt("PrismVote", prismVoteDeployment.address);

    const [voter] = await ethers.getSigners();

    const encryptedInput = await fhevm
      .createEncryptedInput(prismVoteDeployment.address, voter.address)
      .add32(optionIndex)
      .encrypt();

    const tx = await prismVote
      .connect(voter)
      .vote(taskArguments.pollId, encryptedInput.handles[0], encryptedInput.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

/**
 * Example:
 *   - npx hardhat --network sepolia task:end-poll --poll-id 0
 */
task("task:end-poll", "Ends a poll and enables public decryption")
  .addParam("pollId", "Poll id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const prismVoteDeployment = await deployments.get("PrismVote");
    const prismVote = await ethers.getContractAt("PrismVote", prismVoteDeployment.address);

    const [caller] = await ethers.getSigners();

    const tx = await prismVote.connect(caller).endPoll(taskArguments.pollId);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`tx:${tx.hash} status=${receipt?.status}`);
  });

/**
 * Example:
 *   - npx hardhat --network sepolia task:decrypt-counts --poll-id 0
 */
task("task:decrypt-counts", "Decrypts public results for a poll (after end)")
  .addParam("pollId", "Poll id")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const prismVoteDeployment = await deployments.get("PrismVote");
    const prismVote = await ethers.getContractAt("PrismVote", prismVoteDeployment.address);
    const [caller] = await ethers.getSigners();

    const encryptedCounts = await prismVote.getEncryptedCounts(taskArguments.pollId);
    const clearCounts: number[] = [];

    for (let i = 0; i < encryptedCounts.length; i++) {
      const handle = encryptedCounts[i];
      if (handle === ethers.ZeroHash) {
        clearCounts.push(0);
        continue;
      }
      const clear = await fhevm.userDecryptEuint(
        FhevmType.euint32,
        handle,
        prismVoteDeployment.address,
        caller,
      );
      clearCounts.push(clear);
    }

    console.log(`Clear counts: ${clearCounts.join(", ")}`);
  });
