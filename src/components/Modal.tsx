import { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout, useFocus } from "ink";

interface ModalOption {
  label: string;
  value: string;
  shortcut?: string;
}

interface ModalSection {
  title: string;
  options: ModalOption[];
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect?: (value: string) => void;
  title: string;
  sections: ModalSection[];
}

function ModalItem({
  option,
  isSelected,
  width,
}: {
  option: ModalOption;
  isSelected: boolean;
  width: number;
}) {
  const labelWidth = width - (option.shortcut?.length || 0) - 4;
  const paddedLabel = option.label.padEnd(labelWidth);

  return (
    <Box
      backgroundColor={isSelected ? "#D97706" : undefined}
      width={width}
      paddingX={1}
    >
      <Text color={isSelected ? "#000000" : "#E5E7EB"} bold={isSelected}>
        {paddedLabel}
      </Text>
      {option.shortcut && (
        <Text color={isSelected ? "#000000" : "#6B7280"}>
          {option.shortcut}
        </Text>
      )}
    </Box>
  );
}

export function Modal({
  isOpen,
  onClose,
  onSelect,
  title,
  sections,
}: ModalProps) {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    width: stdout.columns || 80,
    height: stdout.rows || 24,
  });

  // Flatten all options for navigation
  const allOptions = sections.flatMap((section) => section.options);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Auto-focus when modal opens
  const { isFocused } = useFocus({ autoFocus: isOpen, id: "modal" });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: stdout.columns || 80,
        height: stdout.rows || 24,
      });
    };

    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  // Reset selection when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useInput(
    (_input, key) => {
      if (key.escape) {
        onClose();
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((prev) => (prev + 1) % allOptions.length);
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((prev) =>
          prev === 0 ? allOptions.length - 1 : prev - 1
        );
        return;
      }

      if (key.return) {
        const selectedOption = allOptions[selectedIndex];
        if (selectedOption && onSelect) {
          onSelect(selectedOption.value);
        }
        onClose();
        return;
      }
    },
    { isActive: isOpen && isFocused }
  );

  if (!isOpen) return null;

  const modalWidth = Math.min(60, dimensions.width - 4);
  const contentWidth = modalWidth - 4;

  // Calculate current option index across all sections
  let currentIndex = 0;

  return (
    <Box
      position="absolute"
      width={dimensions.width}
      height={dimensions.height}
      flexDirection="column"
    >
      {/* Dimmed overlay */}
      <Box
        position="absolute"
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#000000"
      />

      {/* Modal container */}
      <Box
        position="absolute"
        width={dimensions.width}
        height={dimensions.height}
        justifyContent="center"
        alignItems="center"
      >
        <Box
          flexDirection="column"
          width={modalWidth}
          backgroundColor="#1F2937"
          paddingX={2}
          paddingY={1}
        >
          {/* Header */}
          <Box justifyContent="space-between" marginBottom={1}>
            <Text bold color="#FFFFFF">
              {title}
            </Text>
            <Text color="#6B7280">esc</Text>
          </Box>

          {/* Sections */}
          {sections.map((section, sectionIdx) => (
            <Box key={sectionIdx} flexDirection="column" marginBottom={1}>
              {/* Section title */}
              <Box marginBottom={0}>
                <Text bold color="#A78BFA">
                  {section.title}
                </Text>
              </Box>

              {/* Section options */}
              {section.options.map((option) => {
                const isSelected = currentIndex === selectedIndex;
                currentIndex++;

                return (
                  <ModalItem
                    key={option.value}
                    option={option}
                    isSelected={isSelected}
                    width={contentWidth}
                  />
                );
              })}
            </Box>
          ))}

          {/* Footer hint */}
          <Box marginTop={1}>
            <Text color="#6B7280" dimColor>
              Use <Text color="#9CA3AF">↑↓</Text> to navigate,{" "}
              <Text color="#9CA3AF">Enter</Text> to select
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
