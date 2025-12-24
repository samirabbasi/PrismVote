import { useEffect, useMemo, useState } from 'react';
import { Contract } from 'ethers';
import { useAccount, usePublicClient } from 'wagmi';
import { Header } from './Header';
import { CONTRACT_ABI, CONTRACT_ADDRESS } from '../config/contracts';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { useZamaInstance } from '../hooks/useZamaInstance';
import '../styles/VoteApp.css';

type PollItem = {
  id: number;
  title: string;
  options: string[];
  optionCount: number;
  startTime: number;
  endTime: number;
  creator: string;
  ended: boolean;
  publicReady: boolean;
  resultsPublished: boolean;
  encryptedCounts: `0x${string}`[];
  publicCounts: number[];
  hasVoted: boolean;
};

type DecryptedResult = {
  counts: number[];
  proof: `0x${string}`;
};

const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';
const defaultFormOptions = ['Option A', 'Option B'];

function formatTimestamp(seconds: number) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000));
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function VoteApp() {
  const { address, isConnected } = useAccount();
  const signerPromise = useEthersSigner();
  const publicClient = usePublicClient();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();

  const [polls, setPolls] = useState<PollItem[]>([]);
  const [loadingPolls, setLoadingPolls] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const [pollTitle, setPollTitle] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(defaultFormOptions);
  const [pollStart, setPollStart] = useState('');
  const [pollEnd, setPollEnd] = useState('');

  const [voteSelections, setVoteSelections] = useState<Record<number, number>>({});
  const [decryptedResults, setDecryptedResults] = useState<Record<number, DecryptedResult>>({});

  const nowSeconds = useMemo(() => Math.floor(Date.now() / 1000), [refreshIndex, polls.length]);

  const loadPolls = async () => {
    if (!publicClient) return;
    if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
      setPollError('Contract address is not configured.');
      return;
    }

    setLoadingPolls(true);
    setPollError(null);

    try {
      const pollCount = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'getPollCount',
      });

      const count = Number(pollCount);
      const ids = Array.from({ length: count }, (_, index) => index);

      const pollData = await Promise.all(
        ids.map(async (pollId) => {
          const pollResult = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getPoll',
            args: [BigInt(pollId)],
          })) as readonly [
            string,
            readonly [string, string, string, string],
            number,
            bigint,
            bigint,
            `0x${string}`,
            boolean,
            boolean,
            boolean,
          ];

          const [
            title,
            optionsRaw,
            optionCountRaw,
            startTimeRaw,
            endTimeRaw,
            creator,
            ended,
            publicReady,
            resultsPublished,
          ] = pollResult;

          const encryptedCountsRaw = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getEncryptedCounts',
            args: [BigInt(pollId)],
          })) as readonly [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`];

          const publicCountsRaw = (await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: 'getPublicCounts',
            args: [BigInt(pollId)],
          })) as readonly [number, number, number, number];

          const hasVoted = address
            ? await publicClient.readContract({
                address: CONTRACT_ADDRESS,
                abi: CONTRACT_ABI,
                functionName: 'hasVoted',
                args: [BigInt(pollId), address],
              })
            : false;

          const optionCount = Number(optionCountRaw);
          const options = Array.from(optionsRaw).slice(0, optionCount);
          const encryptedCounts = Array.from(encryptedCountsRaw);
          const publicCounts = Array.from(publicCountsRaw).slice(0, optionCount);

          return {
            id: pollId,
            title,
            options,
            optionCount,
            startTime: Number(startTimeRaw),
            endTime: Number(endTimeRaw),
            creator,
            ended,
            publicReady,
            resultsPublished,
            encryptedCounts,
            publicCounts,
            hasVoted: Boolean(hasVoted),
          } as PollItem;
        }),
      );

      setPolls(pollData);
    } catch (error) {
      console.error('Failed to load polls:', error);
      setPollError('Failed to load polls. Please try again.');
    } finally {
      setLoadingPolls(false);
    }
  };

  useEffect(() => {
    loadPolls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, address, refreshIndex]);

  const refreshPolls = () => setRefreshIndex((value) => value + 1);

  const handleAddOption = () => {
    if (pollOptions.length >= 4) return;
    setPollOptions((prev) => [...prev, `Option ${String.fromCharCode(65 + prev.length)}`]);
  };

  const handleRemoveOption = (index: number) => {
    if (pollOptions.length <= 2) return;
    setPollOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreatePoll = async (event: React.FormEvent) => {
    event.preventDefault();
    if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
      alert('Contract address is not configured.');
      return;
    }
    if (!signerPromise) {
      alert('Connect a wallet to create a poll.');
      return;
    }

    const cleanedOptions = pollOptions.map((option) => option.trim()).filter(Boolean);
    if (cleanedOptions.length < 2 || cleanedOptions.length > 4) {
      alert('Provide between 2 and 4 options.');
      return;
    }

    const startTimestamp = pollStart ? Math.floor(new Date(pollStart).getTime() / 1000) : nowSeconds;
    const endTimestamp = Math.floor(new Date(pollEnd).getTime() / 1000);

    if (!pollTitle.trim() || !pollEnd) {
      alert('Title and end time are required.');
      return;
    }

    if (endTimestamp <= startTimestamp) {
      alert('End time must be after the start time.');
      return;
    }

    setPendingAction('Creating poll...');

    try {
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.createPoll(pollTitle.trim(), cleanedOptions, startTimestamp, endTimestamp);
      await tx.wait();
      setPollTitle('');
      setPollOptions(defaultFormOptions);
      setPollStart('');
      setPollEnd('');
      refreshPolls();
    } catch (error) {
      console.error('Failed to create poll:', error);
      alert('Failed to create poll.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleVote = async (pollId: number) => {
    if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
      alert('Contract address is not configured.');
      return;
    }
    if (!instance || !address || !signerPromise) {
      alert('Connect a wallet and wait for encryption to load.');
      return;
    }

    const selected = voteSelections[pollId];
    if (selected === undefined) {
      alert('Select an option before voting.');
      return;
    }

    setPendingAction('Submitting encrypted vote...');

    try {
      const encryptedInput = await instance.createEncryptedInput(CONTRACT_ADDRESS, address).add32(selected).encrypt();
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.vote(pollId, encryptedInput.handles[0], encryptedInput.inputProof);
      await tx.wait();
      refreshPolls();
    } catch (error) {
      console.error('Vote failed:', error);
      alert('Vote failed.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleEndPoll = async (pollId: number) => {
    if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
      alert('Contract address is not configured.');
      return;
    }
    if (!signerPromise) {
      alert('Connect a wallet to end a poll.');
      return;
    }

    setPendingAction('Ending poll...');

    try {
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.endPoll(pollId);
      await tx.wait();
      refreshPolls();
    } catch (error) {
      console.error('End poll failed:', error);
      alert('Failed to end poll.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleDecrypt = async (poll: PollItem) => {
    if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
      alert('Contract address is not configured.');
      return;
    }
    if (!instance) {
      alert('Encryption service is not ready.');
      return;
    }

    setPendingAction('Decrypting results...');

    try {
      const handles = poll.encryptedCounts.slice(0, poll.optionCount);
      const result = await instance.publicDecrypt(handles);
      const counts = handles.map((handle: string) => Number(result.clearValues[handle]));

      setDecryptedResults((prev) => ({
        ...prev,
        [poll.id]: {
          counts,
          proof: result.decryptionProof,
        },
      }));
    } catch (error) {
      console.error('Decryption failed:', error);
      alert('Decryption failed.');
    } finally {
      setPendingAction(null);
    }
  };

  const handlePublish = async (pollId: number) => {
    if (CONTRACT_ADDRESS === ZERO_ADDRESS) {
      alert('Contract address is not configured.');
      return;
    }
    if (!signerPromise) {
      alert('Connect a wallet to publish.');
      return;
    }

    const decrypted = decryptedResults[pollId];
    if (!decrypted) {
      alert('Decrypt results before publishing.');
      return;
    }

    setPendingAction('Publishing on-chain...');

    try {
      const signer = await signerPromise;
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await contract.publishResults(pollId, decrypted.counts, decrypted.proof);
      await tx.wait();
      refreshPolls();
    } catch (error) {
      console.error('Publish failed:', error);
      alert('Failed to publish on-chain.');
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="vote-app">
      <Header />
      <main className="vote-main">
        <section className="hero">
          <div>
            <p className="eyebrow">Encrypted governance</p>
            <h2>Design your polls in public. Count them in private.</h2>
            <p className="hero-subtitle">
              PrismVote keeps votes encrypted until the closing bell. Once a poll ends, anyone can reveal the totals and
              publish verified results on-chain.
            </p>
          </div>
          <div className="hero-card">
            <div>
              <p className="stat-label">Active polls</p>
              <p className="stat-value">{polls.filter((poll) => nowSeconds < poll.endTime).length}</p>
            </div>
            <div>
              <p className="stat-label">Public results</p>
              <p className="stat-value">{polls.filter((poll) => poll.resultsPublished).length}</p>
            </div>
          </div>
        </section>

        <section className="grid">
          <div className="panel">
            <h3>Create a poll</h3>
            <p className="panel-subtitle">Options stay encrypted. You control the schedule.</p>

            <form className="poll-form" onSubmit={handleCreatePoll}>
              <label>
                Title
                <input
                  type="text"
                  value={pollTitle}
                  onChange={(event) => setPollTitle(event.target.value)}
                  placeholder="2025 community grants"
                />
              </label>

              <div className="option-group">
                <span>Options</span>
                {pollOptions.map((option, index) => (
                  <div key={`${option}-${index}`} className="option-row">
                    <input
                      type="text"
                      value={option}
                      onChange={(event) => {
                        const next = [...pollOptions];
                        next[index] = event.target.value;
                        setPollOptions(next);
                      }}
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => handleRemoveOption(index)}
                      disabled={pollOptions.length <= 2}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button type="button" className="ghost-button" onClick={handleAddOption} disabled={pollOptions.length >= 4}>
                  Add option
                </button>
              </div>

              <div className="time-grid">
                <label>
                  Start time
                  <input type="datetime-local" value={pollStart} onChange={(event) => setPollStart(event.target.value)} />
                </label>
                <label>
                  End time
                  <input type="datetime-local" value={pollEnd} onChange={(event) => setPollEnd(event.target.value)} />
                </label>
              </div>

              <button type="submit" className="primary-button" disabled={Boolean(pendingAction)}>
                Create poll
              </button>
            </form>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Live polls</h3>
                <p className="panel-subtitle">Vote, decrypt, and publish on-chain when the time comes.</p>
              </div>
              <button className="ghost-button" onClick={refreshPolls} disabled={loadingPolls}>
                Refresh
              </button>
            </div>

            {pendingAction && <div className="pending-banner">{pendingAction}</div>}
            {zamaError && <div className="error-banner">{zamaError}</div>}
            {pollError && <div className="error-banner">{pollError}</div>}

            {loadingPolls ? (
              <div className="empty-state">Loading polls...</div>
            ) : polls.length === 0 ? (
              <div className="empty-state">No polls yet. Create the first one.</div>
            ) : (
              <div className="poll-list">
                {polls.map((poll) => {
                  const isUpcoming = nowSeconds < poll.startTime;
                  const isActive = nowSeconds >= poll.startTime && nowSeconds < poll.endTime && !poll.ended;
                  const isEnded = poll.ended || nowSeconds >= poll.endTime;
                  const decrypted = decryptedResults[poll.id];

                  return (
                    <div key={poll.id} className="poll-card">
                      <div className="poll-header">
                        <div>
                          <p className="poll-title">{poll.title}</p>
                          <p className="poll-meta">
                            {shortenAddress(poll.creator)} - {formatTimestamp(poll.startTime)} to{' '}
                            {formatTimestamp(poll.endTime)}
                          </p>
                        </div>
                        <span className={`status-chip ${isActive ? 'live' : isUpcoming ? 'upcoming' : 'ended'}`}>
                          {isActive ? 'Live' : isUpcoming ? 'Upcoming' : 'Closed'}
                        </span>
                      </div>

                      <div className="poll-options">
                        {poll.options.map((option, index) => (
                          <div key={`${poll.id}-${index}`} className="option-card">
                            <span>{option}</span>
                            <span className="count-chip">
                              {poll.resultsPublished
                                ? `${poll.publicCounts[index]} on-chain`
                                : decrypted
                                  ? `${decrypted.counts[index]} decrypted`
                                  : 'Encrypted'}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="poll-actions">
                        {isActive && isConnected && !poll.hasVoted && (
                          <div className="vote-actions">
                            <div className="vote-select">
                              {poll.options.map((option, index) => (
                                <label key={`${poll.id}-vote-${index}`}>
                                  <input
                                    type="radio"
                                    name={`vote-${poll.id}`}
                                    checked={voteSelections[poll.id] === index}
                                    onChange={() =>
                                      setVoteSelections((prev) => ({
                                        ...prev,
                                        [poll.id]: index,
                                      }))
                                    }
                                  />
                                  {option}
                                </label>
                              ))}
                            </div>
                            <button
                              className="primary-button"
                              onClick={() => handleVote(poll.id)}
                              disabled={Boolean(pendingAction) || zamaLoading}
                            >
                              Cast encrypted vote
                            </button>
                          </div>
                        )}

                        {isActive && poll.hasVoted && <div className="info-banner">Vote submitted.</div>}

                        {!isConnected && isActive && <div className="info-banner">Connect your wallet to vote.</div>}

                        {isEnded && !poll.publicReady && (
                          <button className="primary-button" onClick={() => handleEndPoll(poll.id)} disabled={Boolean(pendingAction)}>
                            End poll
                          </button>
                        )}

                        {poll.publicReady && (
                          <div className="result-actions">
                            <button
                              className="ghost-button"
                              onClick={() => handleDecrypt(poll)}
                              disabled={Boolean(pendingAction)}
                            >
                              Decrypt results
                            </button>
                            <button
                              className="primary-button"
                              onClick={() => handlePublish(poll.id)}
                              disabled={Boolean(pendingAction) || poll.resultsPublished}
                            >
                              Publish on-chain
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
