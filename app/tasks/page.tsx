import { permanentRedirect } from "next/navigation";

export default function TasksPage() {
  // タスクボードはプロジェクト管理に統合されたため、`/projects?from=tasks` に
  // 308 で恒久的にリダイレクトする（next.config.ts の redirects と二重に張る）。
  permanentRedirect("/projects?from=tasks");
}
