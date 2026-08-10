import { Link } from "react-router-dom";
import { copy } from "../../config/tokens";
import PublicNavLinks from "../PublicNavLinks";

// Nav + footer for /docs and /docs/:slug when viewed signed-out — mirrors
// Blog.tsx/BlogPost.tsx's own nav+footer markup so the public site reads as
// one consistent shell. Signed-in visitors never see this: Docs/DocsPage
// mount inside the app's own Layout instead (see DocsShell).
export function PublicDocsNav() {
  return (
    <nav className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-16 py-5 sm:py-7 max-w-[1440px] mx-auto">
      <div className="flex items-center gap-6 lg:gap-10 min-w-0">
        <Link to="/" className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
          <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-6 sm:h-7 w-auto shrink-0" />
          <span className="font-bold text-lg sm:text-xl tracking-[-0.01em] text-fg-primary truncate">
            {copy.appName}
          </span>
        </Link>
        <PublicNavLinks />
      </div>
      <div className="flex items-center gap-3 sm:gap-5 md:gap-8 shrink-0">
        <Link
          to="/login"
          className="text-sm sm:text-[15px] font-medium text-fg-muted hover:text-fg-primary transition-colors duration-150 whitespace-nowrap"
        >
          {copy.pages.landing.login}
        </Link>
        <Link
          to="/register"
          className="inline-flex items-center px-3.5 py-2 sm:px-5 sm:py-2.5 border border-fg-accent rounded-lg text-fg-accent font-semibold text-xs sm:text-sm whitespace-nowrap hover:bg-fg-accent/10 transition-colors duration-150"
        >
          {copy.pages.landing.cta}
        </Link>
      </div>
    </nav>
  );
}

export function PublicDocsFooter() {
  return (
    <footer className="max-w-[1440px] mx-auto px-6 md:px-16 pt-12 pb-16 border-t border-fg-subtle/20 flex flex-col gap-8">
      <div className="flex gap-10 flex-wrap justify-center">
        <Link to="/pricing" className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150">
          Pricing
        </Link>
        <Link to="/roadmap" className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150">
          Roadmap
        </Link>
        <Link to="/blog" className="text-sm text-fg-muted hover:text-fg-primary transition-colors duration-150">
          Blog
        </Link>
        <Link to="/docs" className="text-sm text-fg-primary transition-colors duration-150">
          Docs
        </Link>
      </div>
      <div className="flex items-center justify-center gap-3">
        <img src="/svg/sybil-mark.svg" alt="Sybil" className="h-6 w-auto opacity-60" />
        <span className="font-bold text-[15px] tracking-[0.02em] text-[#5A6167]">{copy.appName}</span>
      </div>
    </footer>
  );
}
