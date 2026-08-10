interface SettingsSectionProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Consistent title + description + content block for a Settings tab
 * section, so each tab doesn't reinvent its own header layout.
 */
export default function SettingsSection({ title, description, badge, children, className = "" }: SettingsSectionProps) {
  return (
    <section className={`mb-8 ${className}`}>
      <div className="flex items-center gap-2.5 mb-1">
        <h2 className="text-sm font-medium text-fg-primary">{title}</h2>
        {badge}
      </div>
      {description && <p className="text-[13.5px] text-fg-muted mb-3">{description}</p>}
      <div className={description ? "" : "mt-3"}>{children}</div>
    </section>
  );
}
