import { copy } from "../config/tokens";

/**
 * Projects — organise tasks and sentinels by client or initiative.
 */
export default function Projects() {
  return (
    <div className="w-full max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-fg-primary mb-2.5">
        {copy.pages.projects.title}
      </h1>
      <p className="text-fg-muted text-sm mb-8">{copy.pages.projects.subtitle}</p>

      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg px-4 py-6 text-center">
        <p className="text-fg-muted text-sm">
          Here you'll be able to group tasks and sentinels by project, client, or initiative.
        </p>
        <p className="text-fg-subtle text-xs mt-1">
          Projects are created automatically when you assign a task to a new
          client.
        </p>
      </div>
    </div>
  );
}
