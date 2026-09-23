import { World } from "./world/World.tsx";
import { TopBar } from "./hud/TopBar.tsx";
import { FrontLabels } from "./hud/FrontLabels.tsx";
import { Markers } from "./hud/Markers.tsx";
import { Bubble } from "./hud/Bubble.tsx";
import { Panel } from "./hud/Panel.tsx";
import { Toast } from "./hud/Toast.tsx";
import { ReportSheet } from "./hud/ReportSheet.tsx";
import { RepoSheet } from "./hud/RepoSheet.tsx";
import { DeleteSheet } from "./hud/DeleteSheet.tsx";
import { Terminals } from "./hud/Terminals.tsx";
import { useAutoOpenRepos } from "./hud/useAutoOpenRepos.ts";

export function App() {
  useAutoOpenRepos();
  return (
    <>
      <World />
      <FrontLabels />
      <Markers />
      <Bubble />
      <TopBar />
      <Terminals />
      <Panel />
      <ReportSheet />
      <RepoSheet />
      <DeleteSheet />
      <Toast />
    </>
  );
}
