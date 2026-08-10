import { Link } from "react-router-dom";

// Topbar counterpart to the public-site footer links — same destinations
// (minus Status/Privacy/Cookie, which stay footer-only), shown to the right
// of the logo and persistent across Landing/Pricing/Roadmap/Blog/Docs.
export default function PublicNavLinks() {
  return (
    <div className="hidden md:flex items-center gap-6 lg:gap-8">
      <Link
        to="/pricing"
        className="text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 whitespace-nowrap"
      >
        Pricing
      </Link>
      <Link
        to="/roadmap"
        className="text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 whitespace-nowrap"
      >
        Roadmap
      </Link>
      <Link
        to="/blog"
        className="text-sm font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 whitespace-nowrap"
      >
        Blog
      </Link>
    </div>
  );
}
