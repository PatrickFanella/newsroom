import type {PublicEpisode}from '@/lib/public-episode';
import {chapterTime}from '@/lib/broadcast';
export function EpisodeContent({episode}:{episode:PublicEpisode}) {
 return <article className="space-y-5"><h1 className="font-display text-3xl font-bold break-words">{episode.title}</h1><p className="font-mono text-xs text-ink/60">{episode.started_at.slice(0,10)+' (UTC)'} · {episode.stories.length} covered stories</p>
  {episode.recording_url && <a className="inline-block underline" href={episode.recording_url} target="_blank" rel="noreferrer">Watch recording ↗</a>}
  <ol className="space-y-5">{episode.stories.map((story,index)=><li key={index} className="border-l-2 border-ink/20 pl-4 space-y-2"><h2 className="font-display text-xl font-bold break-words">{story.title}</h2><div className="flex flex-wrap gap-3 text-xs font-mono">{story.url && <a className="underline" href={story.url} target="_blank" rel="noreferrer">Source ↗</a>}{story.chapter_url && <a className="underline" href={story.chapter_url} target="_blank" rel="noreferrer">{story.chapter_seconds===null ? 'Recording' : chapterTime(story.chapter_seconds)} in recording ↗</a>}</div>{story.summary && <p className="text-sm whitespace-pre-wrap break-words">{story.summary}</p>}{story.takeaway && <blockquote className="text-sm whitespace-pre-wrap break-words text-ink/70">{story.takeaway}</blockquote>}</li>)}</ol>
  {!episode.stories.length && <p className="text-sm text-ink/60">No covered stories in this episode.</p>}
 </article>;
}
