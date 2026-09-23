import { World } from "./world/World.tsx";
import { TopBar } from "./hud/TopBar.tsx";
import { FrontLabels } from "./hud/FrontLabels.tsx";
import { Markers } from "./hud/Markers.tsx";
import { Bubble } from "./hud/Bubble.tsx";
import { Panel } from "./hud/Panel.tsx";
import { Toast } from "./hud/Toast.tsx";
import { ReportSheet } from "./hud/ReportSheet.tsx";

export function App() {
  return (
    <>
      <World />
      <FrontLabels />
      <Markers />
      <Bubble />
      <TopBar />
      <Panel />
      <ReportSheet />
      <Toast />
    </>
  );
}
