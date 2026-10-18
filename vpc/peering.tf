# No automatic peering with the account's default VPC.
# Add peering only with explicit peer IDs, non-overlapping CIDRs, and routes
# on BOTH VPCs. EKS itself does not require VPC peering.
