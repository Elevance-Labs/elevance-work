// Only for `yarn typecheck` (supabase/functions/tsconfig.json): the bits of
// Deno the functions use, and the esm.sh import mapped to the supabase-js
// types in node_modules. The Edge runtime itself never reads this file.
declare namespace Deno {
  const env: { get(name: string): string | undefined }
  function serve(handler: (req: Request) => Response | Promise<Response>): void
}
declare module 'https://esm.sh/@supabase/supabase-js@2.117.2' {
  export * from '@supabase/supabase-js'
}
