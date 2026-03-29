import React, { useMemo } from 'react';

interface SummaryRowProps {
  optionChainData: any | null;
  spotPrice: number;
  expiryDate: string;
  volatility: number;
}

const SummaryRow: React.FC<SummaryRowProps> = ({
  optionChainData,
  spotPrice,
  expiryDate,
  volatility,
}) => {
  // Calculate totals and Greeks
  const metrics = useMemo(() => {
    if (!optionChainData || !optionChainData.strikes) {
      return {
        volCE: 0,
        volPE: 0,
        callOI: 0,
        putOI: 0,
        pcr: 0,
        beta: 0,
      };
    }

    const strikes = optionChainData.strikes;

    // Helper functions to handle both nested (ce.volume) and flat (ceVolume) property structures
    const getCEVolume = (strike: any): number => strike.ce?.volume || strike.ceVolume || 0;
    const getPEVolume = (strike: any): number => strike.pe?.volume || strike.peVolume || 0;
    const getCEOI = (strike: any): number => strike.ce?.oi || strike.ceOI || 0;
    const getPEOI = (strike: any): number => strike.pe?.oi || strike.peOI || 0;

    // Calculate total volumes from API data
    const volCE = strikes.reduce((sum: number, strike: any) => sum + getCEVolume(strike), 0);
    const volPE = strikes.reduce((sum: number, strike: any) => sum + getPEVolume(strike), 0);

    // Calculate total open interest from API data
    const callOI = strikes.reduce((sum: number, strike: any) => sum + getCEOI(strike), 0);
    const putOI = strikes.reduce((sum: number, strike: any) => sum + getPEOI(strike), 0);

    // Calculate PCR (Put-Call Ratio) - Use backend PCR if available, otherwise calculate
    const pcr = optionChainData.pcr || (callOI > 0 ? putOI / callOI : 0);

    return {
      volCE,
      volPE,
      callOI,
      putOI,
      pcr,
    };
  }, [optionChainData, spotPrice, expiryDate, volatility]);

  // Determine PCR color and message
  const getPCRStyle = (pcr: number) => {
    if (pcr > 1.3) {
      return { color: 'var(--success-color)', message: 'Strongly Bullish' };
    } else if (pcr < 0.6) {
      return { color: 'var(--danger-color)', message: 'Strongly Bearish' };
    }
    return { color: 'var(--text-primary)', message: 'Neutral' };
  };

  const pcrStyle = getPCRStyle(metrics.pcr);

  // Format large numbers
  const formatNumber = (num: number): string => {
    if (num >= 10000000) {
      return `${(num / 10000000).toFixed(2)}Cr`;
    } else if (num >= 100000) {
      return `${(num / 100000).toFixed(2)}L`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(2)}K`;
    }
    return num.toFixed(0);
  };

  return (
    <div className="summary-row">
      <div className="summary-grid">
        <div className="summary-item">
          <div className="summary-label">Vol CE (total)</div>
          <div className="summary-value">{formatNumber(metrics.volCE)}</div>
        </div>

        <div className="summary-item">
          <div className="summary-label">Vol PE (total)</div>
          <div className="summary-value">{formatNumber(metrics.volPE)}</div>
        </div>

        <div className="summary-item">
          <div className="summary-label">Call OI (total)</div>
          <div className="summary-value">{formatNumber(metrics.callOI)}</div>
        </div>

        <div className="summary-item">
          <div className="summary-label">Put OI (total)</div>
          <div className="summary-value">{formatNumber(metrics.putOI)}</div>
        </div>

        <div className="summary-item pcr-item" title={pcrStyle.message}>
          <div className="summary-label">PCR</div>
          <div className="summary-value" style={{ color: pcrStyle.color }}>
            {metrics.pcr.toFixed(3)}
          </div>
          <div className="pcr-message" style={{ color: pcrStyle.color }}>
            {pcrStyle.message}
          </div>
        </div>
      </div>

      <style>{`
        .summary-row {
          background: var(--card-bg);
          border-radius: 4px;
          padding: 1px 4px;
          margin: 0;
          position: relative;
          z-index: 1;
          width: 100%;
        }

        .summary-grid {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .summary-item {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 2px 6px;
          background: linear-gradient(135deg, var(--bg-secondary) 0%, rgba(30, 30, 30, 0.95) 100%);
          border-radius: 4px;
          border: 1px solid var(--border-color);
          white-space: nowrap;
        }

        .summary-label {
          font-size: 0.65rem;
          color: var(--text-secondary);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          line-height: 1;
        }

        .summary-value {
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
        }

        .pcr-item {
          position: relative;
        }

        .pcr-message {
          font-size: 0.6rem;
          font-weight: 600;
          line-height: 1;
        }

        @media (max-width: 1024px) {
          .summary-grid {
            grid-template-columns: repeat(5, 1fr);
          }
        }

        @media (max-width: 768px) {
          .summary-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 480px) {
          .summary-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  );
};

export default SummaryRow;
