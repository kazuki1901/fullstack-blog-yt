import { prisma } from '@/app/lib/prisma'
import { NextResponse } from 'next/server'

//ブログ投稿の詳細を取得するAPI
export async function GET(req: Request) {
    try {
        const id: number = parseInt(req.url.split('/blog/')[1]);
        const post = await prisma.post.findFirst({where: { id }});
        return NextResponse.json({ message: 'Success', post}, { status:200});
    } catch (error) {
        console.error('Error fetching blog post:', error)
        return NextResponse.json({ error: 'Error fetching blog post' }, { status: 500 })
    } finally {
        await prisma.$disconnect();
    }
}

//ブログ投稿の詳細を編集するAPI
export async function PUT(req: Request) {
    try {
        const id: number = parseInt(req.url.split('/blog/')[1]);

        const { title, description } = await req.json();

        const post = await prisma.post.update({
            where: { id },
            data: { title, description }
        });
        return NextResponse.json({ message: 'Success', post}, { status:200});
    } catch (error) {
        console.error('Error updating blog post:', error)
        return NextResponse.json({ error: 'Error updating blog post' }, { status: 500 })
    } finally {
        await prisma.$disconnect();
    }
}

//ブログ投稿の詳細を削除するAPI
export async function DELETE(req: Request) {
    try {
        const id: number = parseInt(req.url.split('/blog/')[1]);

        const post = await prisma.post.delete({
            where: { id }
        });
        return NextResponse.json({ message: 'Success', post}, { status:200});
    } catch (error) {
        console.error('Error deleting blog post:', error)
        return NextResponse.json({ error: 'Error deleting blog post' }, { status: 500 })
    } finally {
        await prisma.$disconnect();
    }
}