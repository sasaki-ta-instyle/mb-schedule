import { Suspense } from "react";
import { ProjectsPanel } from "@/components/projects/ProjectsPanel";

export default function ProjectsPage() {
  // useSearchParams は Suspense 境界を要求するため、ここで包む。
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 24 }}>読み込み中…</p>}>
      <ProjectsPanel />
    </Suspense>
  );
}
