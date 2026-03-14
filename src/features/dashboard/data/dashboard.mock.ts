import { buildTree, flattenTree } from "../../sitemap/model/sitemap.utils";

const mockSitemapFlat = [
  { path: "/", status: 200, method: "GET" },
  { path: "/admin", status: 403, method: "GET" },
  { path: "/admin/login", status: 200, method: "POST" },
  { path: "/admin/dashboard", status: 401, method: "GET" },
  { path: "/admin/users", status: 401, method: "GET" },
  { path: "/api", status: 200, method: "GET" },
  { path: "/api/v1", status: 200, method: "GET" },
  { path: "/api/v1/users", status: 200, method: "GET" },
  { path: "/api/v1/prod", status: 200, method: "GET" },
  { path: "/api/v1/orders", status: 201, method: "POST" },
  { path: "/api/v2", status: 200, method: "GET" },
  { path: "/api/v2/users", status: 200, method: "GET" },
  { path: "/api/v2/prod", status: 200, method: "GET" },
  { path: "/api/v2/orderssssssss", status: 201, method: "POST" },
  { path: "/api/health", status: 200, method: "GET" },
  { path: "/shop", status: 200, method: "GET" },
  { path: "/shop/products", status: 200, method: "GET" },
  { path: "/shop/cart", status: 200, method: "GET" },
  { path: "/shop/checkout", status: 200, method: "POST" },
  { path: "/about", status: 200, method: "GET" },
  { path: "/contact", status: 200, method: "GET" },
  { path: "/robots.txt", status: 200, method: "GET" },
  { path: "/.git", status: 403, method: "GET" },
];

export const mockSitemapTree = buildTree(mockSitemapFlat);
export const mockSitemapFlatNodes = flattenTree(mockSitemapTree);

export const mockVulnerabilities = [
  {
    id: "1",
    severity: "critical" as const,
    title: "Reflected XSS",
    path: "/admin/search?q=",
  },
  {
    id: "2",
    severity: "critical" as const,
    title: "SQL Injection",
    path: "/api/v1/users?id=",
  },
  {
    id: "3",
    severity: "high" as const,
    title: "CSRF Missing Token",
    path: "/shop/checkout",
  },
  {
    id: "4",
    severity: "medium" as const,
    title: "Directory Listing",
    path: "/uploads/",
  },
  {
    id: "5",
    severity: "medium" as const,
    title: "Sensitive Data Exposure",
    path: "/.git/config",
  },
  {
    id: "6",
    severity: "low" as const,
    title: "Missing Security Headers",
    path: "/",
  },
  {
    id: "7",
    severity: "info" as const,
    title: "Outdated jQuery",
    path: "/js/jquery-1.12.4.min.js",
  },
];

export const mockChatMessages = [
  {
    id: "1",
    sender: "system" as const,
    content: "Session started. Initiating reconnaissance...",
    timestamp: "14:32",
  },
  {
    id: "2",
    sender: "ai" as const,
    content:
      "I've completed the initial scan of the target. Found 23 endpoints and identified several potential attack vectors.",
    timestamp: "14:32",
  },
  {
    id: "3",
    sender: "user" as const,
    content: "What are the most critical findings?",
    timestamp: "14:33",
  },
  {
    id: "4",
    sender: "ai" as const,
    content:
      "The most critical findings are: 1) SQL Injection vulnerability in /api/v1/users with the 'id' parameter. 2) Reflected XSS in the admin search functionality. 3) Exposed .git directory containing sensitive configuration.",
    timestamp: "14:33",
  },
  {
    id: "5",
    sender: "user" as const,
    content: "Can you elaborate on the SQL injection?",
    timestamp: "14:34",
  },
  {
    id: "6",
    sender: "ai" as const,
    content:
      "The /api/v1/users endpoint accepts an 'id' parameter that appears to be directly concatenated into SQL queries without parameterization. I detected this using boolean-based blind testing. The backend appears to be MySQL 8.x. Recommend running SQLMap for full exploitation analysis.",
    timestamp: "14:34",
  },
];
