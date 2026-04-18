import { AppProvider } from "./application/AppProvider";
import Workspace from "./presentation/Workspace";

export default function App() {
  return (
    <AppProvider>
      <Workspace />
    </AppProvider>
  );
}
