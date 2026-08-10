// Same two iubenda-hosted policy chips shown in the homepage footer —
// reused everywhere else the public-site footer appears so Privacy/Cookie
// always point at the real documents instead of a "#" placeholder.
export default function PublicLegalLinks() {
  return (
    <>
      <a
        href="https://www.iubenda.com/privacy-policy/53699391"
        className="iubenda-white iubenda-noiframe iubenda-embed text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150"
        title="Privacy Policy"
      >
        Privacy Policy
      </a>
      <a
        href="https://www.iubenda.com/privacy-policy/53699391/cookie-policy"
        className="iubenda-white iubenda-noiframe iubenda-embed text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150"
        title="Cookie Policy"
      >
        Cookie Policy
      </a>
    </>
  );
}
