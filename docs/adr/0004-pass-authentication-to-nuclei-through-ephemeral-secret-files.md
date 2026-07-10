# Pass authentication to Nuclei through ephemeral Secret Files

NullTrace will translate an approved authenticated Nuclei action into a per-run Secret File passed by path with Nuclei's `-sf` option, rather than place cookies or headers in command-line flags. The file is owner-restricted and removed when the run finishes so authorization material is absent from persisted commands, process arguments, tool logs, and chat-visible artifacts.
