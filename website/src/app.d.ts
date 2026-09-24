import type { AuthUser } from "$lib/auth-types";

declare global {
  namespace App {
    interface Locals {
      user: AuthUser | null;
    }
  }
}
declare module "*.md" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
  export const metadata: Record<string, any>;
}
export {};
