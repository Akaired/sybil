import { Briefcase, Megaphone, Code2, GraduationCap, Plus, Users } from "lucide-react";
import ComingSoonBadge from "../../components/settings/ComingSoonBadge";
import SettingsSection from "../../components/settings/SettingsSection";

interface SkillDef {
  name: string;
  description: string;
  icon: React.ReactNode;
}

const SKILLS: SkillDef[] = [
  {
    name: "Agency",
    description: "Reasons by client and quote, and proposes sentinels on client silence.",
    icon: <Briefcase size={18} strokeWidth={1.6} />,
  },
  {
    name: "Marketing",
    description: "Reasons by campaign and editorial calendar, and proposes sentinels on mentions and competitors.",
    icon: <Megaphone size={18} strokeWidth={1.6} />,
  },
  {
    name: "Development",
    description: "Reasons by milestone and estimate, and proposes sentinels on deadlines at risk.",
    icon: <Code2 size={18} strokeWidth={1.6} />,
  },
  {
    name: "Student",
    description: "Merges university and work commitments into a single priority queue.",
    icon: <GraduationCap size={18} strokeWidth={1.6} />,
  },
];

function SkillToggle() {
  return (
    <button
      type="button"
      disabled
      aria-label="Enable skill (coming soon)"
      className="relative w-9 h-5 rounded-full bg-fg-subtle/20 cursor-not-allowed shrink-0"
    >
      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-fg-subtle/60" />
    </button>
  );
}

/**
 * Skills tab — local UI only, no network calls. Toggles and the custom
 * skill button are inert previews of a not-yet-built feature.
 */
export default function SettingsSkills() {
  return (
    <div>
      <SettingsSection
        title="Skills"
        description="Skills change how Sybil reasons about your work — what questions it asks, which sentinels it proposes."
      >
        <div className="space-y-3">
          {SKILLS.map((skill) => (
            <div
              key={skill.name}
              className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-5 py-4 flex items-center gap-4"
            >
              <div className="w-9 h-9 rounded-lg bg-fg-subtle/10 flex items-center justify-center text-fg-muted shrink-0">
                {skill.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-fg-primary font-medium">{skill.name}</p>
                <p className="text-[13px] text-fg-subtle mt-0.5">{skill.description}</p>
              </div>
              <ComingSoonBadge />
              <SkillToggle />
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled
          className="mt-3 w-full flex items-center justify-center gap-2 border border-dashed border-fg-subtle/25 rounded-lg px-5 py-3.5 text-sm font-medium text-fg-subtle cursor-not-allowed"
        >
          <Plus size={16} strokeWidth={1.8} />
          Create custom skill
          <ComingSoonBadge />
        </button>
      </SettingsSection>

      <SettingsSection
        title="Subagents"
        description="Specialists Sybil consults when it needs domain-specific judgment — they answer to Sybil, not to you."
        badge={<ComingSoonBadge />}
      >
        <div className="border border-dashed border-fg-subtle/25 rounded-lg px-5 py-6 flex items-center gap-3 text-fg-subtle">
          <Users size={18} strokeWidth={1.6} className="shrink-0" />
          <p className="text-[13.5px]">Subagent configuration isn't available yet.</p>
        </div>
      </SettingsSection>
    </div>
  );
}
