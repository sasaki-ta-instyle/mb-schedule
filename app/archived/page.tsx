import { Dashboard } from "@/components/dashboard/Dashboard";
import { ArchivedProjectsPanel } from "@/components/admin/ArchivedProjectsPanel";

export default function ArchivedPage() {
  return (
    <>
      <ArchivedProjectsPanel />
      <Dashboard archived />
    </>
  );
}
