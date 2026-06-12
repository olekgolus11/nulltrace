# Separate findings from finding reviews

NullTrace treats findings as scanner-derived observations and finding reviews as operator-derived judgment. This keeps tool mappers and finding upserts focused on what scanners observed, while review status can change independently without being overwritten by later scan runs.
