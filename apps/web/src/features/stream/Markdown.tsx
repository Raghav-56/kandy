import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { GithubMark } from "@/ui/GithubMark"

/**
 * Agents write markdown. Showing it raw means reading `**Verified**:` and
 * counting backticks — which is exactly the reading-a-log feeling this panel
 * is supposed to replace.
 *
 * Rendered through react-markdown rather than a string-to-HTML library: agent
 * output is untrusted text, and this way there is no innerHTML anywhere near
 * it. Links open in a new tab and never navigate the board away.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md text-prose leading-[1.65] text-ink", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          /*
            A link that leaves for GitHub says so.
            
            Agents cite pull requests, issues and files constantly, and a bare
            blue span gives no clue whether it is a heading in this page or a
            trip to the forge. The mark is only added for github.com itself, so
            an unrelated host never borrows its authority.
          */
          a: ({ node: _node, href, children, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sky inline-flex items-baseline gap-1 underline underline-offset-2"
            >
              {isGithub(href) && <GithubMark className="size-3 shrink-0 self-center opacity-80" />}
              {children}
            </a>
          ),
          code: ({ node: _node, className: cls, children, ...props }) => {
            const inline = !String(cls ?? "").includes("language-")
            return inline ? (
              <code
                {...props}
                className="rounded bg-raised px-1 py-px font-mono text-ui text-[#d9c8a0]"
              >
                {children}
              </code>
            ) : (
              <code {...props} className="font-mono text-ui">
                {children}
              </code>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

/** github.com and its subdomains only — never a host that merely contains it. */
function isGithub(href: string | undefined): boolean {
  if (!href) return false
  try {
    const { hostname } = new URL(href, window.location.origin)
    return hostname === "github.com" || hostname.endsWith(".github.com")
  } catch {
    return false
  }
}
