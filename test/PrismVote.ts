import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = await ethers.getContractFactory("PrismVote");
  const prismVoteContract = await factory.deploy();
  const prismVoteContractAddress = await prismVoteContract.getAddress();

  return { prismVoteContract, prismVoteContractAddress };
}

describe("PrismVote", function () {
  let signers: Signers;
  let prismVoteContract: any;
  let prismVoteContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ prismVoteContract, prismVoteContractAddress } = await deployFixture());
  });

  it("creates a poll and counts votes after end", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const startTime = (latestBlock?.timestamp ?? 0) + 1;
    const endTime = startTime + 60;

    const createTx = await prismVoteContract
      .connect(signers.deployer)
      .createPoll("City Budget", ["Parks", "Transit"], startTime, endTime);
    await createTx.wait();

    await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + 1]);
    await ethers.provider.send("evm_mine", []);

    const encryptedVoteAlice = await fhevm
      .createEncryptedInput(prismVoteContractAddress, signers.alice.address)
      .add32(0)
      .encrypt();
    await (
      await prismVoteContract
        .connect(signers.alice)
        .vote(0, encryptedVoteAlice.handles[0], encryptedVoteAlice.inputProof)
    ).wait();

    const encryptedVoteBob = await fhevm
      .createEncryptedInput(prismVoteContractAddress, signers.bob.address)
      .add32(1)
      .encrypt();
    await (
      await prismVoteContract
        .connect(signers.bob)
        .vote(0, encryptedVoteBob.handles[0], encryptedVoteBob.inputProof)
    ).wait();

    await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
    await ethers.provider.send("evm_mine", []);

    await (await prismVoteContract.connect(signers.deployer).endPoll(0)).wait();

    const encryptedCounts = await prismVoteContract.getEncryptedCounts(0);
    const clearCount0 = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedCounts[0],
      prismVoteContractAddress,
      signers.alice,
    );
    const clearCount1 = await fhevm.userDecryptEuint(
      FhevmType.euint32,
      encryptedCounts[1],
      prismVoteContractAddress,
      signers.alice,
    );

    expect(clearCount0).to.eq(1);
    expect(clearCount1).to.eq(1);
  });

  it("prevents double voting", async function () {
    const latestBlock = await ethers.provider.getBlock("latest");
    const startTime = (latestBlock?.timestamp ?? 0) + 1;
    const endTime = startTime + 600;

    await (
      await prismVoteContract
        .connect(signers.deployer)
        .createPoll("Design Direction", ["Minimal", "Bold"], startTime, endTime)
    ).wait();

    await ethers.provider.send("evm_setNextBlockTimestamp", [startTime + 1]);
    await ethers.provider.send("evm_mine", []);

    const encryptedVote = await fhevm
      .createEncryptedInput(prismVoteContractAddress, signers.alice.address)
      .add32(0)
      .encrypt();

    await (
      await prismVoteContract
        .connect(signers.alice)
        .vote(0, encryptedVote.handles[0], encryptedVote.inputProof)
    ).wait();

    await expect(
      prismVoteContract.connect(signers.alice).vote(0, encryptedVote.handles[0], encryptedVote.inputProof),
    ).to.be.revertedWith("Already voted");
  });
});
