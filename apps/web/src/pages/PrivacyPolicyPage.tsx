import type { ReactNode } from 'react';
import { Box, Container, Divider, Link, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export default function PrivacyPolicyPage() {
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
            Privacy Policy
          </Typography>
          <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 3 }}>
            Effective Date: April 4, 2026
          </Typography>

          <Section title="1. Introduction">
            <p>This Privacy Policy explains how we collect, use, and protect your information when you use this platform.</p>
            <p>By accessing or using this platform, you agree to the terms of this Privacy Policy.</p>
          </Section>

          <Section title="2. Information We Collect">
            <p>We may collect the following types of information:</p>
            <SubHeading>Personal Information</SubHeading>
            <BulletList items={['Name', 'Email address', 'Mobile number']} />
            <SubHeading>Usage Data</SubHeading>
            <BulletList items={['Login activity', 'Device information', 'Interaction with dashboard features']} />
            <SubHeading>Payment Information</SubHeading>
            <BulletList items={['Payment status', 'Transaction reference']} />
            <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>
              Note:
            </Typography>
            <p>
              We do NOT store sensitive payment details such as card numbers or banking credentials. Payments are processed
              securely through third-party payment providers.
            </p>
          </Section>

          <Section title="3. How We Use Your Information">
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
              User Rights:
            </Typography>
            <p>Users have the right to:</p>
            <BulletList
              items={[
                'Access their personal data',
                'Request correction of inaccurate data',
                'Request deletion of their data',
              ]}
            />
            <p>Requests can be made by contacting us at the email provided below.</p>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 2 }} gutterBottom>
              We use your information to:
            </Typography>
            <BulletList
              items={[
                'Provide access to the platform',
                'Manage subscriptions',
                'Improve system performance',
                'Communicate important updates',
                'Ensure platform security',
              ]}
            />
          </Section>

          <Section title="4. Data Protection">
            <p>We take reasonable measures to protect your data, including:</p>
            <BulletList
              items={['Secure server environments', 'Restricted access to sensitive information', 'Encrypted communication where applicable']}
            />
            <p>
              In the event of a data breach, we will notify affected users within a reasonable timeframe as required by
              applicable law.
            </p>
            <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>
              However:
            </Typography>
            <p>No system is completely secure, and we cannot guarantee absolute security.</p>
          </Section>

          <Section title="5. Sharing of Information">
            <p>We do NOT sell or rent your personal data.</p>
            <p>We may share information only:</p>
            <BulletList items={['With trusted service providers (e.g., payment gateways)', 'When required by law']} />
          </Section>

          <Section title="6. Cookies & Tracking">
            <p>This platform may use cookies or similar technologies to:</p>
            <BulletList items={['Improve user experience', 'Analyze usage patterns']} />
            <p>We may use:</p>
            <BulletList items={['Session cookies (for login functionality)', 'Analytics cookies (to improve performance)']} />
            <p>Third-party tools may also use cookies as per their own policies.</p>
            <p>You can disable cookies in your browser settings if you prefer.</p>
          </Section>

          <Section title="7. User Responsibilities">
            <p>Users are responsible for:</p>
            <BulletList items={['Keeping login details confidential', 'Not sharing access with others', 'Using the platform responsibly']} />
          </Section>

          <Section title="8. Data Retention">
            <p>We retain user data:</p>
            <BulletList items={['As long as the account is active', 'Or as required for legal and operational purposes']} />
            <p>Users may request deletion of their account and associated data, subject to legal and operational requirements.</p>
          </Section>

          <Section title="9. Third-Party Services">
            <p>This platform may use third-party services such as:</p>
            <BulletList items={['Payment gateways', 'Hosting providers']} />
            <p>These services have their own privacy policies, and we are not responsible for their practices.</p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>We may update this Privacy Policy at any time.</p>
            <p>Users are encouraged to review it periodically.</p>
          </Section>

          <Section title="11. Contact">
            <p>For any questions regarding this Privacy Policy, you may contact:</p>
            <Typography component="p" sx={{ mt: 1 }}>
              <Link href="mailto:primexa1967@gmail.com">primexa1967@gmail.com</Link>
            </Typography>
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

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <Typography variant="subtitle2" fontWeight="bold" sx={{ mt: 2, mb: 0.5 }}>
      {children}
    </Typography>
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
