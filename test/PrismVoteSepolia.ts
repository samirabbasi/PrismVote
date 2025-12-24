import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { expect } from "chai";

type Signers = {
  alice: HardhatEthersSigner;
};

describe("PrismVoteSepolia", function () {
  let signers: Signers;
  let prismVoteContract: any;
  let prismVoteContractAddress: string;

  before(async function () {
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }

    try {
      const prismVoteDeployment = await deployments.get("PrismVote");
      prismVoteContractAddress = prismVoteDeployment.address;
      prismVoteContract = await ethers.getContractAt("PrismVote", prismVoteDeployment.address);
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia'";
      throw e;
    }

    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { alice: ethSigners[0] };
  });

  it("creates a poll and casts an encrypted vote", async function () {
    this.timeout(4 * 40000);

    const latestBlock = await ethers.provider.getBlock("latest");
    const startTime = (latestBlock?.timestamp ?? 0) - 10;
    const endTime = startTime + 3600;

    const createTx = await prismVoteContract
      .connect(signers.alice)
      .createPoll("Protocol Upgrade", ["Approve", "Reject"], startTime, endTime);
    await createTx.wait();

    const pollCount = await prismVoteContract.getPollCount();
    const pollId = Number(pollCount) - 1;

    const encryptedCountsBefore = await prismVoteContract.getEncryptedCounts(pollId);

    const encryptedVote = await fhevm
      .createEncryptedInput(prismVoteContractAddress, signers.alice.address)
      .add32(0)
      .encrypt();

    const voteTx = await prismVoteContract
      .connect(signers.alice)
      .vote(pollId, encryptedVote.handles[0], encryptedVote.inputProof);
    await voteTx.wait();

    const encryptedCountsAfter = await prismVoteContract.getEncryptedCounts(pollId);
    expect(encryptedCountsAfter[0]).to.not.eq(encryptedCountsBefore[0]);
  });
});
