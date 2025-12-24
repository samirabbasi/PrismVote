// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title PrismVote
/// @notice Encrypted on-chain voting with public decryption after poll end.
contract PrismVote is ZamaEthereumConfig {
    struct Poll {
        string title;
        string[4] options;
        uint8 optionCount;
        uint64 startTime;
        uint64 endTime;
        address creator;
        bool ended;
        bool publicReady;
        bool resultsPublished;
        euint32[4] encryptedCounts;
        uint32[4] publicCounts;
    }

    mapping(uint256 => Poll) private _polls;
    mapping(uint256 => mapping(address => bool)) private _hasVoted;
    uint256 private _pollCount;

    event PollCreated(
        uint256 indexed pollId,
        address indexed creator,
        string title,
        uint8 optionCount,
        uint64 startTime,
        uint64 endTime
    );
    event VoteCast(uint256 indexed pollId, address indexed voter);
    event PollEnded(uint256 indexed pollId);
    event ResultsPublished(uint256 indexed pollId);

    function getPollCount() external view returns (uint256) {
        return _pollCount;
    }

    function getPoll(uint256 pollId)
        external
        view
        returns (
            string memory title,
            string[4] memory options,
            uint8 optionCount,
            uint64 startTime,
            uint64 endTime,
            address creator,
            bool ended,
            bool publicReady,
            bool resultsPublished
        )
    {
        _requirePollExists(pollId);
        Poll storage poll = _polls[pollId];
        return (
            poll.title,
            poll.options,
            poll.optionCount,
            poll.startTime,
            poll.endTime,
            poll.creator,
            poll.ended,
            poll.publicReady,
            poll.resultsPublished
        );
    }

    function getEncryptedCounts(uint256 pollId) external view returns (euint32[4] memory counts) {
        _requirePollExists(pollId);
        return _polls[pollId].encryptedCounts;
    }

    function getPublicCounts(uint256 pollId) external view returns (uint32[4] memory counts) {
        _requirePollExists(pollId);
        return _polls[pollId].publicCounts;
    }

    function hasVoted(uint256 pollId, address voter) external view returns (bool) {
        _requirePollExists(pollId);
        return _hasVoted[pollId][voter];
    }

    function createPoll(
        string calldata title,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime
    ) external returns (uint256 pollId) {
        require(options.length >= 2 && options.length <= 4, "Invalid option count");
        require(endTime > startTime, "Invalid time range");

        pollId = _pollCount;
        _pollCount += 1;

        Poll storage poll = _polls[pollId];
        poll.title = title;
        poll.optionCount = uint8(options.length);
        poll.startTime = startTime;
        poll.endTime = endTime;
        poll.creator = msg.sender;

        for (uint8 i = 0; i < poll.optionCount; i++) {
            poll.options[i] = options[i];
        }

        for (uint8 i = 0; i < 4; i++) {
            poll.encryptedCounts[i] = FHE.asEuint32(0);
            FHE.allowThis(poll.encryptedCounts[i]);
        }

        emit PollCreated(pollId, msg.sender, title, poll.optionCount, startTime, endTime);
    }

    function vote(uint256 pollId, externalEuint32 encryptedChoice, bytes calldata inputProof) external {
        _requirePollExists(pollId);
        Poll storage poll = _polls[pollId];

        require(!poll.ended, "Poll ended");
        require(block.timestamp >= poll.startTime, "Poll not started");
        require(block.timestamp < poll.endTime, "Poll closed");
        require(!_hasVoted[pollId][msg.sender], "Already voted");

        euint32 choice = FHE.fromExternal(encryptedChoice, inputProof);
        euint32 one = FHE.asEuint32(1);
        euint32 zero = FHE.asEuint32(0);

        for (uint8 i = 0; i < poll.optionCount; i++) {
            ebool isChoice = FHE.eq(choice, FHE.asEuint32(i));
            euint32 increment = FHE.select(isChoice, one, zero);
            poll.encryptedCounts[i] = FHE.add(poll.encryptedCounts[i], increment);
            FHE.allowThis(poll.encryptedCounts[i]);
        }

        _hasVoted[pollId][msg.sender] = true;
        emit VoteCast(pollId, msg.sender);
    }

    function endPoll(uint256 pollId) external {
        _requirePollExists(pollId);
        Poll storage poll = _polls[pollId];

        require(!poll.ended, "Poll already ended");
        require(block.timestamp >= poll.endTime, "Poll still active");

        poll.ended = true;
        poll.publicReady = true;

        for (uint8 i = 0; i < poll.optionCount; i++) {
            FHE.makePubliclyDecryptable(poll.encryptedCounts[i]);
        }

        emit PollEnded(pollId);
    }

    function publishResults(
        uint256 pollId,
        uint32[] calldata clearCounts,
        bytes calldata decryptionProof
    ) external {
        _requirePollExists(pollId);
        Poll storage poll = _polls[pollId];

        require(poll.publicReady, "Results not public");
        require(!poll.resultsPublished, "Results already published");
        require(clearCounts.length == poll.optionCount, "Invalid results length");

        bytes32[] memory handles = new bytes32[](poll.optionCount);
        for (uint8 i = 0; i < poll.optionCount; i++) {
            handles[i] = euint32.unwrap(poll.encryptedCounts[i]);
        }

        bytes memory cleartexts;
        if (poll.optionCount == 2) {
            cleartexts = abi.encode(clearCounts[0], clearCounts[1]);
        } else if (poll.optionCount == 3) {
            cleartexts = abi.encode(clearCounts[0], clearCounts[1], clearCounts[2]);
        } else {
            cleartexts = abi.encode(clearCounts[0], clearCounts[1], clearCounts[2], clearCounts[3]);
        }

        FHE.checkSignatures(handles, cleartexts, decryptionProof);

        for (uint8 i = 0; i < poll.optionCount; i++) {
            poll.publicCounts[i] = clearCounts[i];
        }

        poll.resultsPublished = true;
        emit ResultsPublished(pollId);
    }

    function _requirePollExists(uint256 pollId) internal view {
        require(pollId < _pollCount, "Poll does not exist");
    }
}
