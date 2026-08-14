import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, Trash2, ExternalLink } from 'lucide-react'
import { useBlogPosts } from '../lib/queries'
import { deleteBlogPost, type BlogPost } from '../lib/blog'
import { queryClient, qk } from '../lib/queries'
import { PageHeader, Badge, Button, EmptyState, Spinner, Card } from '../components/ui'
import { useToast, toastMessage } from '../components/Toast'

function statusTone(status: BlogPost['status']): 'green' | 'grey' {
  return status === 'published' ? 'green' : 'grey'
}

function PostCard({ post, onDelete }: { post: BlogPost; onDelete: (id: string) => void }) {
  const navigate = useNavigate()
  const wordCount = post.sections.reduce((n, s) => n + s.body.split(/\s+/).filter(Boolean).length, 0)
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <Badge tone={statusTone(post.status)}>{post.status}</Badge>
        <button
          onClick={() => onDelete(post.id)}
          className="text-muted hover:text-[var(--accent-orange)] transition-colors"
          aria-label="Delete post"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <button onClick={() => navigate(`/blog/${post.id}`)} className="text-left flex-1">
        {post.banner_url ? (
          <img src={post.banner_url} alt="" className="w-full h-32 object-cover rounded-lg mb-2" />
        ) : (
          <div className="w-full h-32 rounded-lg mb-2 flex items-center justify-center" style={{ background: 'var(--fill-tertiary)' }}>
            <FileText size={20} className="text-muted" />
          </div>
        )}
        <div className="font-medium text-sm line-clamp-2">{post.title || 'Untitled post'}</div>
        <div className="text-muted text-xs mt-1">{post.category} · {wordCount ? `${wordCount} words` : 'Empty draft'}</div>
      </button>
      {post.status === 'published' && post.slug && (
        <a
          href={`https://www.scalepods.co/blog/${post.slug}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-sage flex items-center gap-1 hover:underline"
        >
          View live <ExternalLink size={11} />
        </a>
      )}
    </Card>
  )
}

export default function Blog() {
  const navigate = useNavigate()
  const toast = useToast()
  const { data: posts = [], isLoading } = useBlogPosts()
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all')

  const filtered = filter === 'all' ? posts : posts.filter((p) => p.status === filter)

  async function onDelete(id: string) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return
    try {
      await deleteBlogPost(id)
      queryClient.invalidateQueries({ queryKey: qk.blogPosts })
      toast.success('Post deleted')
    } catch (err) {
      toast.error(toastMessage(err, 'Could not delete this post'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Blog"
        subtitle="Write and publish posts to scalepods.co — see docs/blog-module.md for how this connects to the live site."
        actions={
          <Button onClick={() => navigate('/blog/new')}>
            <Plus size={15} /> New post
          </Button>
        }
      />

      <div className="flex items-center gap-2 mb-5">
        {(['all', 'draft', 'published'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={f === filter ? 'badge' : 'badge badge-grey opacity-60'}
            style={{ textTransform: 'capitalize' }}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={24} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} />}
          title={filter === 'all' ? 'No posts yet' : `No ${filter} posts`}
          hint="Create a post to write and publish to the ScalePods website."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((post) => (
            <PostCard key={post.id} post={post} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
