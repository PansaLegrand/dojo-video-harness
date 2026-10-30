import Link from 'next/link';
import VideoEditAiHome from '@/components/applications/video-edit-ai-home';
export default async function Page({params}:{params:Promise<{lang:string}>}){const {lang}=await params;return <><header className="flex h-[65px] items-center justify-between border-b bg-background px-6"><Link href={`/${lang}/applications/video-edit-ai`} className="font-semibold">Dojo Video Harness</Link><Link href={`/${lang}/settings`} className="text-sm text-muted-foreground">Provider settings</Link></header><VideoEditAiHome locale={lang} restyleHref={null}/></>}
