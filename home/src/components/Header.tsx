import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="header-content">
          <div className="header-left">
            <div className="brand">
              <span className="brand-mark">PrismVote</span>
              <span className="brand-tagline">Encrypted polls with public-proof results.</span>
            </div>
          </div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
