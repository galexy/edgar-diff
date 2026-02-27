#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Firewall for Claude Code devcontainer
#
# Policy: Allow all outbound HTTPS/HTTP traffic for web research, plus
# standard development ports (DNS, SSH). No secrets in this repo, so the
# firewall is permissive. Tighten when secrets are introduced.
#
# Still blocks: non-standard ports, raw TCP to arbitrary ports, etc.
###############################################################################

# ---------------------------------------------------------------------------
# Disable IPv6 (defense-in-depth — iptables rules are IPv4-only)
# ---------------------------------------------------------------------------
sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1 || true
sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Flush existing rules
# ---------------------------------------------------------------------------
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

# Destroy existing ipsets (ignore errors if they don't exist)
ipset destroy allowed-ips 2>/dev/null || true
ipset destroy allowed-cidrs 2>/dev/null || true

# ---------------------------------------------------------------------------
# Default policies
# ---------------------------------------------------------------------------
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

# ---------------------------------------------------------------------------
# Allow loopback
# ---------------------------------------------------------------------------
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# ---------------------------------------------------------------------------
# Allow established / related connections
# ---------------------------------------------------------------------------
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# ---------------------------------------------------------------------------
# Allow DNS (UDP + TCP port 53) — needed for domain resolution
# ---------------------------------------------------------------------------
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# ---------------------------------------------------------------------------
# Allow SSH (port 22) — needed for git over SSH
# ---------------------------------------------------------------------------
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

# ---------------------------------------------------------------------------
# Allow traffic to host network (Docker host communication)
# ---------------------------------------------------------------------------
# Common Docker bridge gateway
iptables -A OUTPUT -d 172.17.0.0/16 -j ACCEPT
# Host-mapped gateway
iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT
iptables -A OUTPUT -d 10.0.0.0/8 -j ACCEPT

# ---------------------------------------------------------------------------
# Allow ALL outbound HTTPS (443) and HTTP (80)
#
# This enables unrestricted web research (blogs, docs, Stack Overflow, etc.)
# while still blocking non-web ports. Tighten to ipset-based whitelist when
# secrets are added to the repo.
# ---------------------------------------------------------------------------
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
echo ""
echo "=== Firewall configured (permissive web access) ==="
echo ""
echo "Testing web access (example.com)..."
if curl --connect-timeout 3 -sf https://example.com >/dev/null 2>&1; then
    echo "OK: example.com is reachable (web access open)"
else
    echo "WARNING: example.com is not reachable — check firewall rules"
fi

echo "Testing GitHub (api.github.com)..."
if curl --connect-timeout 5 -sf https://api.github.com/zen >/dev/null 2>&1; then
    echo "OK: api.github.com is reachable"
else
    echo "WARNING: api.github.com is not reachable"
fi

echo ""
echo "Firewall initialization complete."
echo "Allowed: DNS (53), SSH (22), HTTP (80), HTTPS (443), local networks"
echo "Blocked: all other outbound ports"
