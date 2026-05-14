import Link from "next/link";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const posts = await prisma.post.findMany({
    orderBy: { date: "desc" },
  });

  return (
    <main className="w-full h-full">
      <div className="md:w-2/4 sm:w-3/4 m-auto p-4 my-5 rounded-lg bg-blue-900 drop-shadow-xl">
        <h1 className="text-slate-200 text-center text-2xl font-extrabold">
          Full Stack Blog 📝
        </h1>
      </div>

      <div className="flex flex-wrap justify-center gap-3 my-5">
        <Link
          href={"/blog/add"}
          className="md:w-1/6 sm:w-2/4 text-center rounded-md p-2 bg-slate-300 font-semibold"
        >
          ブログ新規作成
        </Link>
        <Link
          href={"/qr"}
          className="md:w-1/6 sm:w-2/4 text-center rounded-md p-2 bg-slate-300 font-semibold"
        >
          QRコード読み取り
        </Link>
      </div>

      <div className="w-full flex flex-col justify-center items-center">
        {posts.map((post) => (
          <div
            key={post.id}
            className="w-3/4 p-4 rounded-md mx-3 my-2 bg-slate-300 flex flex-col justify-center"
          >
            <div className="flex items-center my-3">
              <div className="mr-auto">
                <h2 className="mr-auto font-semibold">{post.title}</h2>
              </div>
              <Link
                href={`/blog/edit/${post.id}`}
                className="px-4 py-1 text-center text-xl bg-slate-900 rounded-md font-semibold text-slate-200"
              >
                編集
              </Link>
            </div>

            <div className="mr-auto my-1">
              <blockquote className="font-bold text-slate-700">
                {new Date(post.date).toLocaleDateString("ja-JP")}
              </blockquote>
            </div>

            <div className="mr-auto my-1">
              <h2>{post.description}</h2>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
