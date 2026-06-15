import { ScrollBoxRenderable } from "@opentui/core";
import { theme } from "../../../app/theme/theme";
import {
  FindingReviewStatus,
  SessionFindingRecord,
} from "../model/finding.types";
import {
  severityConfig,
  severityLabels,
} from "../model/finding-summary.constants";
import {
  createFindingSourceContextFields,
  FindingSourceContextField,
} from "../services/finding-source-context";

interface FindingDetailModalProps {
  finding: SessionFindingRecord;
  width: number;
  height: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
}

const reviewStatusConfig: Record<
  SessionFindingRecord["reviewStatus"],
  { color: string; label: string; marker: string }
> = {
  needs_review: {
    color: theme.accent.warning,
    label: "Needs review",
    marker: "[NR]",
  },
  confirmed: {
    color: theme.accent.primary,
    label: "Confirmed",
    marker: "[OK]",
  },
  dismissed: {
    color: theme.text.muted,
    label: "Dismissed",
    marker: "[NO]",
  },
};

const reviewActionHints: Array<{
  key: string;
  label: string;
  reviewStatus: FindingReviewStatus;
}> = [
  {
    key: "1",
    label: "Needs review",
    reviewStatus: "needs_review",
  },
  {
    key: "2",
    label: "Confirm",
    reviewStatus: "confirmed",
  },
  {
    key: "3",
    label: "Dismiss",
    reviewStatus: "dismissed",
  },
];

const modalScrollbarTrackOptions = {
  backgroundColor: theme.border.muted,
  foregroundColor: theme.text.secondary,
} as const;

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function MetadataRow({ label, value }: FindingSourceContextField) {
  return (
    <box flexDirection="row">
      <box width={18}>
        <text fg={theme.text.dim}>{label}</text>
      </box>
      <text fg={theme.text.secondary}>{value}</text>
    </box>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <box marginTop={1}>
      <text fg={theme.accent.primary}>
        <strong>{children}</strong>
      </text>
    </box>
  );
}

function ReviewActionBar({
  reviewStatus,
}: {
  reviewStatus: FindingReviewStatus;
}) {
  const currentStatus = reviewStatusConfig[reviewStatus];

  return (
    <box
      flexDirection="row"
      height={3}
      border
      borderColor={theme.border.muted}
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
      marginBottom={1}
    >
      <box flexGrow={1}>
        <text fg={currentStatus.color}>
          <strong>
            {currentStatus.marker} {currentStatus.label}
          </strong>
        </text>
      </box>
      <text fg={theme.text.dim}>
        {reviewActionHints.map((hint, index) => {
          const isActive = hint.reviewStatus === reviewStatus;
          const hintStatus = reviewStatusConfig[hint.reviewStatus];

          return (
            <span key={hint.key}>
              {index > 0 ? "  " : ""}
              <span fg={isActive ? hintStatus.color : theme.text.secondary}>
                <strong>{hint.key}</strong>
              </span>{" "}
              <span fg={isActive ? hintStatus.color : theme.text.dim}>
                {isActive ? <strong>{hint.label}</strong> : hint.label}
              </span>
            </span>
          );
        })}
      </text>
    </box>
  );
}

export function FindingDetailModal({
  finding,
  width,
  height,
  scrollRef,
}: FindingDetailModalProps) {
  const reviewStatus = reviewStatusConfig[finding.reviewStatus];
  const sourceContext = createFindingSourceContextFields(finding);
  const metadata: FindingSourceContextField[] = [
    {
      label: "Severity",
      value: severityConfig[finding.severity].label,
    },
    {
      label: "Review Status",
      value: `${reviewStatus.marker} ${reviewStatus.label}`,
    },
    {
      label: "Kind",
      value: finding.kind,
    },
    {
      label: "Source Tool",
      value: finding.sourceTool,
    },
    {
      label: "Target",
      value: finding.target,
    },
    {
      label: "Artifact ID",
      value: finding.toolRunArtifactId,
    },
    {
      label: "First Seen",
      value: formatTimestamp(finding.firstSeenAt),
    },
    {
      label: "Last Seen",
      value: formatTimestamp(finding.lastSeenAt),
    },
  ];
  const contentHeight = Math.max(1, height - 8);
  const contentWidth = Math.max(1, width - 4);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor={theme.bg.overlay}
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={width}
        height={height}
        flexDirection="column"
        border
        borderColor={theme.accent.primary}
        backgroundColor={theme.bg.panel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box flexDirection="row" marginBottom={1}>
          <box flexGrow={1}>
            <text fg={theme.accent.primary}>
              <strong>Finding Detail</strong>
            </text>
          </box>
          <text fg={theme.text.dim}>Esc close</text>
        </box>

        <ReviewActionBar reviewStatus={finding.reviewStatus} />

        <scrollbox
          ref={scrollRef}
          height={contentHeight}
          width={contentWidth}
          scrollY={true}
          stickyScroll={false}
          verticalScrollbarOptions={{
            width: 2,
            visible: true,
            trackOptions: modalScrollbarTrackOptions,
          }}
        >
          <box flexDirection="column" width={Math.max(1, contentWidth - 2)}>
            <box flexDirection="row">
              <text fg={severityConfig[finding.severity].color}>
                <strong>{severityLabels[finding.severity]}</strong>
              </text>
              <text fg={theme.text.dim}> </text>
              <text fg={reviewStatus.color}>
                <strong>{reviewStatus.marker}</strong>
              </text>
            </box>

            <text fg={theme.text.primary}>
              <strong>{finding.title}</strong>
            </text>
            <text fg={theme.text.secondary}>{finding.summary}</text>

            <SectionTitle>Metadata</SectionTitle>
            {metadata.map((field) => (
              <MetadataRow
                key={field.label}
                label={field.label}
                value={field.value}
              />
            ))}

            <SectionTitle>Source Context</SectionTitle>
            {sourceContext.map((field, index) => (
              <MetadataRow
                key={`${field.label}-${index}`}
                label={field.label}
                value={field.value}
              />
            ))}
          </box>
        </scrollbox>
      </box>
    </box>
  );
}
