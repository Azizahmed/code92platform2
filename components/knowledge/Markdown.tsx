import ReactMarkdown, {type Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Every block carries dir="auto" so an Arabic paragraph flows RTL inside an
// English document and vice versa — authors write in whichever language they
// think in without splitting the field in two.
const COMPONENTS: Components = {
  p: ({children}) => <p dir="auto">{children}</p>,
  h1: ({children}) => <h2 dir="auto">{children}</h2>,
  h2: ({children}) => <h2 dir="auto">{children}</h2>,
  h3: ({children}) => <h3 dir="auto">{children}</h3>,
  h4: ({children}) => <h4 dir="auto">{children}</h4>,
  li: ({children}) => <li dir="auto">{children}</li>,
  blockquote: ({children}) => <blockquote dir="auto">{children}</blockquote>,
  td: ({children}) => <td dir="auto">{children}</td>,
  th: ({children}) => <th dir="auto">{children}</th>,
  a: ({href, children}) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
};

export default function Markdown({content}: {content: string}) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
