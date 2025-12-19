import { useState } from "react";
import { useApp, useInput } from "ink";
import { HomeScreen, SecondScreen } from "./screens/index.ts";

type Screen = "home" | "second";

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>("home");
  const { exit } = useApp();

  // Global quit handler
  useInput((input) => {
    if (input === "q") {
      exit();
    }
  });

  switch (currentScreen) {
    case "home":
      return (
        <HomeScreen onNavigateToSecond={() => setCurrentScreen("second")} />
      );
    case "second":
      return <SecondScreen onBack={() => setCurrentScreen("home")} />;
    default:
      return (
        <HomeScreen onNavigateToSecond={() => setCurrentScreen("second")} />
      );
  }
}
