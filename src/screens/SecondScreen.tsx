import { Box, Text } from "ink";
import BigText from "ink-big-text";
import { Screen, Button } from "../components/index.ts";

interface SecondScreenProps {
  onBack: () => void;
}

export function SecondScreen({ onBack }: SecondScreenProps) {
  return (
    <Screen>
      {/* Header */}
      <Box flexDirection="column" alignItems="center" marginBottom={2}>
        <Text color="#60A5FA">
          <BigText text="Page 2" font="simple3d" />
        </Text>
        <Text color="#6B7280">You have navigated to the second screen!</Text>
      </Box>

      {/* Content box */}
      <Box
        backgroundColor="#1F2937"
        paddingX={4}
        paddingY={2}
        marginY={2}
        flexDirection="column"
        alignItems="center"
      >
        <Text color="#E5E7EB">Welcome to the second screen!</Text>
        <Text color="#6B7280">This demonstrates navigation between views.</Text>
      </Box>

      {/* Back button */}
      <Box marginTop={2}>
        <Button
          label=" Back to Home "
          onPress={onBack}
          width={20}
          autoFocus
          focusId="btn-back"
        />
      </Box>

      {/* Footer hints */}
      <Box marginTop={3} flexDirection="column" alignItems="center">
        <Text color="#4B5563">
          <Text color="#6B7280">Enter</Text> go back{" "}
          <Text color="#6B7280">q</Text> quit
        </Text>
      </Box>
    </Screen>
  );
}
