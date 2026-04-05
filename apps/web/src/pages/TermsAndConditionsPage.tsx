import type { ReactNode } from 'react';
import { Box, Container, Divider, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export default function TermsAndConditionsPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
        py: 4,
      }}
    >
      <Container maxWidth="md">
        <Link component={RouterLink} to="/login" color="primary" sx={{ display: 'inline-block', mb: 2 }}>
          ← Back to login
        </Link>
        <Box
          sx={{
            bgcolor: 'background.paper',
            borderRadius: 2,
            p: { xs: 2, sm: 4 },
            boxShadow: 6,
          }}
        >
          <Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
            Terms &amp; Conditions
          </Typography>
          <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
            Effective Date: April 4, 2026
          </Typography>

          <Section title="1. Introduction">
            <p>
              Welcome to this platform. By accessing or using this website and its services, you agree to comply with and
              be bound by these Terms &amp; Conditions.
            </p>
            <p>If you do not agree with any part of these terms, please do not use the platform.</p>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 2 }} gutterBottom>
              Eligibility:
            </Typography>
            <p>Users must be at least 18 years of age to use this platform.</p>
          </Section>

          <Section title="2. Nature of the Platform">
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
              Regulatory Disclaimer:
            </Typography>
            <p>
              This platform is not registered with the Securities and Exchange Board of India (SEBI) as an Investment Advisor
              or Research Analyst.
            </p>
            <p>
              The platform does not provide personalized investment recommendations, portfolio management, or financial
              advisory services.
            </p>
            <p>This platform is intended solely for educational and research purposes.</p>
            <p>It provides:</p>
            <BulletList items={['Market data visualization', 'Analytical tools', 'Model-based insights']} />
            <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>
              Important Notice:
            </Typography>
            <p>This platform does NOT provide financial, investment, or trading advice.</p>
          </Section>

          <Section title="3. No Investment Advice">
            <p>All content, data, signals, and analysis available on this platform:</p>
            <BulletList
              items={[
                'Are for informational and educational use only',
                'Do not constitute buy/sell recommendations',
                'Should not be considered financial advice',
              ]}
            />
            <p>
              The platform provides model-generated insights based on predefined logic and should not be interpreted as
              trading signals or recommendations.
            </p>
            <p>Users must:</p>
            <BulletList items={['Conduct their own research', 'Consult a qualified financial advisor before making decisions']} />
          </Section>

          <Section title="4. Risk Disclosure">
            <p>Financial markets involve:</p>
            <BulletList items={['High volatility', 'Potential loss of capital']} />
            <p>Past performance of any model or analysis does not guarantee future results.</p>
            <p>By using this platform:</p>
            <p>You acknowledge that all trading decisions are made at your own discretion and risk.</p>
          </Section>

          <Section title="5. User Responsibility">
            <p>Users agree that:</p>
            <BulletList
              items={[
                'They are solely responsible for their actions',
                'They will not rely solely on this platform for financial decisions',
                'They understand the risks involved',
              ]}
            />
          </Section>

          <Section title="6. Subscription & Payments">
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
              Access Model:
            </Typography>
            <p>This platform operates on a subscription basis.</p>
            <p>By subscribing, you agree:</p>
            <BulletList
              items={[
                'You are paying for access to analytical tools and dashboards only',
                'No guarantees of profit or performance are provided',
                'Subscription does not include financial advisory services',
              ]}
            />
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 2 }} gutterBottom>
              Payment Terms:
            </Typography>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 1 }} gutterBottom>
              Refund Policy:
            </Typography>
            <p>Payments are generally non-refundable.</p>
            <p>However, refunds may be issued in the following cases:</p>
            <BulletList items={['Duplicate transactions', 'Technical issues preventing access']} />
            <p>Refund requests must be submitted within 3 days of payment.</p>
            <p>No guarantee of results is implied</p>
          </Section>

          <Section title="7. Account & Access Control">
            <p>Users must:</p>
            <BulletList items={['Provide accurate information', 'Maintain account confidentiality']} />
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 2 }} gutterBottom>
              Device Limit:
            </Typography>
            <p>Access may be restricted to a limited number of devices per user</p>
            <p>Misuse or sharing may result in suspension</p>
          </Section>

          <Section title="8. Intellectual Property">
            <p>All content, including:</p>
            <BulletList items={['Dashboard logic', 'Design', 'Data structure']} />
            <p>Is the property of the platform owner.</p>
            <p>Users are NOT allowed to:</p>
            <BulletList items={['Copy', 'Redistribute', 'Reverse-engineer', 'Resell']} />
          </Section>

          <Section title="9. Limitation of Liability">
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
              No Warranty:
            </Typography>
            <p>
              The platform is provided on an &quot;as-is&quot; and &quot;as-available&quot; basis without warranties of any
              kind, including accuracy, reliability, or fitness for a particular purpose.
            </p>
            <p>The platform owner shall NOT be responsible for:</p>
            <BulletList items={['Financial losses', 'Trading decisions', 'Data inaccuracies', 'System downtime']} />
            <p>Use of the platform is entirely at your own risk.</p>
          </Section>

          <Section title="10. Service Availability">
            <p>We aim to maintain continuous service but do not guarantee uninterrupted availability.</p>
            <BulletList items={['Downtime may occur', 'Data delays may happen']} />
            <p>We do NOT guarantee:</p>
            <BulletList items={['Uninterrupted access', 'Real-time accuracy at all times']} />
          </Section>

          <Section title="11. Termination">
            <p>We reserve the right to:</p>
            <BulletList items={['Suspend or terminate accounts', 'Restrict access']} />
            <p>If:</p>
            <BulletList items={['Terms are violated', 'Misuse is detected']} />
          </Section>

          <Section title="12. Modifications">
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
              Governing Law:
            </Typography>
            <p>
              These Terms shall be governed by and interpreted in accordance with the laws of India. Any disputes shall be
              subject to the exclusive jurisdiction of courts located in Kolkata, West Bengal.
            </p>
            <p>These terms may be updated at any time.</p>
            <p>Users are encouraged to review them periodically.</p>
          </Section>

          <Section title="13. Acceptance">
            <p>By using this platform, you confirm that:</p>
            <BulletList
              items={[
                'You understand this is an educational/research tool',
                'You accept all risks',
                'You agree to these Terms & Conditions',
              ]}
            />
          </Section>

          <Section title="User Acknowledgment">
            <p>
              Users must actively accept these terms via a mandatory checkbox before accessing the platform or making any
              payment.
            </p>
            <Box
              component="ul"
              sx={{
                pl: 2,
                listStyle: 'none',
                '& li': { position: 'relative', pl: 2, mb: 1 },
              }}
            >
              <Typography component="li" variant="body1">
                <Box component="span" sx={{ position: 'absolute', left: 0 }}>
                  ☑
                </Box>
                I understand that this platform is for educational and research purposes only
              </Typography>
              <Typography component="li" variant="body1">
                <Box component="span" sx={{ position: 'absolute', left: 0 }}>
                  ☑
                </Box>
                I acknowledge the risks involved in financial markets
              </Typography>
              <Typography component="li" variant="body1">
                <Box component="span" sx={{ position: 'absolute', left: 0 }}>
                  ☑
                </Box>
                I agree that all decisions are my own responsibility
              </Typography>
            </Box>
          </Section>
        </Box>
      </Container>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom fontWeight="bold">
        {title}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="body1" component="div" sx={{ '& p': { mb: 1.5 }, color: 'text.primary' }}>
        {children}
      </Typography>
    </Box>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <Box component="ul" sx={{ pl: 2.5, my: 1 }}>
      {items.map((item) => (
        <Typography key={item} component="li" variant="body1" sx={{ mb: 0.5 }}>
          {item}
        </Typography>
      ))}
    </Box>
  );
}
