import { World } from "./world/World.tsx";
import { TopBar } from "./hud/TopBar.tsx";
import { FrontLabels } from "./hud/FrontLabels.tsx";
import { Panel } from "./hud/Panel.tsx";
import { Toast } from "./hud/Toast.tsx";

export function App() {
  return (
    <>
      <World />
      <FrontLabels />
      <TopBar />
      <Panel />
      <Toast />
    </>
  );
}
