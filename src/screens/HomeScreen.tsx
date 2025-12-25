import { useState } from "react";
import { Box, Text, useInput, useFocusManager } from "ink";
import BigText from "ink-big-text";
import { Screen, Button, Modal } from "../components/index.ts";

interface HomeScreenProps {
  onNavigateToSecond: () => void;
}

// Modal sections configuration
const MODAL_SECTIONS = [
  {
    title: "Actions",
    options: [
      { label: "View Dashboard", value: "dashboard", shortcut: "ctrl+d" },
      { label: "Open Settings", value: "settings", shortcut: "ctrl+s" },
      { label: "Show Help", value: "help", shortcut: "ctrl+h" },
    ],
  },
  {
    title: "Navigation",
    options: [
      { label: "Go to Home", value: "home", shortcut: "ctrl+1" },
      { label: "Go to Second Screen", value: "second", shortcut: "ctrl+2" },
    ],
  },
  {
    title: "Other",
    options: [
      { label: "Toggle Theme", value: "theme" },
      { label: "Clear Cache", value: "cache" },
      { label: "Quit Application", value: "quit", shortcut: "q" },
    ],
  },
];

export function HomeScreen({ onNavigateToSecond }: HomeScreenProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { focusNext, focusPrevious } = useFocusManager();

  useInput(
    (_input, key) => {
      if (key.downArrow) {
        focusNext();
      }
      if (key.upArrow) {
        focusPrevious();
      }
    },
    { isActive: !isModalOpen },
  );

  const handleModalSelect = (value: string) => {
    if (value === "second") {
      onNavigateToSecond();
    }
    // Handle other options as needed
  };

  return (
    <Screen>
      {/* Header with title */}
      <Box flexDirection="column" alignItems="center" marginBottom={2}>
        <Text color="#A78BFA">
          <BigText text="TUI Demo" font="simple3d" />
        </Text>
        <Text color="#6B7280">A beautiful terminal UI with React Ink</Text>
      </Box>

      {/* Main content - buttons */}
      <Box flexDirection="column" alignItems="center" gap={1} marginTop={2}>
        <Button
          label="  Open Commands  "
          onPress={() => setIsModalOpen(true)}
          width={24}
          autoFocus
          focusId="btn-modal"
        />
        <Button
          label=" Go to Page 2 "
          onPress={onNavigateToSecond}
          width={24}
          focusId="btn-second"
        />
      </Box>

      {/* Footer hints */}
      <Box marginTop={3} flexDirection="column" alignItems="center">
        <Text color="#4B5563">
          <Text color="#6B7280">↑↓</Text> navigate{" "}
          <Text color="#6B7280">Enter</Text> select{" "}
          <Text color="#6B7280">q</Text> quit
        </Text>
      </Box>

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelect={handleModalSelect}
        title="Commands"
        sections={MODAL_SECTIONS}
      />
    </Screen>
  );
}
