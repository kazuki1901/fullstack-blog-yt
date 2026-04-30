import { prisma } from '@/app/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
    try {
        const posts = await prisma.post.findMany()
        return NextResponse.json({ message: 'Success', posts}, { status:200});
    } catch (error) {
        console.error('Error fetching blog posts:', error)
        return NextResponse.json({ error: 'Error fetching blog posts' }, { status: 500 })
    } finally {
        await prisma.$disconnect();
    }
}

//ブログ投稿用API
export async function POST(req: Request, res:NextResponse) {
    try {
        const { title, description } = await req.json();

        const post = await prisma.post.create({data: { title, description }});
        return NextResponse.json({ message: 'Success', post}, { status:201});
    } catch (error) {
        console.error('Error creating blog post:', error)
        return NextResponse.json({ error: 'Error creating blog post' }, { status: 500 })
    } finally {
        await prisma.$disconnect();
    }
}