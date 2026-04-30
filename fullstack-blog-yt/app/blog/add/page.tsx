'use client';
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const postBlog = async (title: string, description: string) => {
    const res = await fetch('http://localhost:3000/api/blog', {
        method: 'POST',
        body: JSON.stringify({ title, description }),
        headers: { 'Content-Type': 'application/json' }
    });
    return res.json();
};

const PostBlog = () => {
    const router = useRouter();

    const titleRef = useRef<HTMLInputElement | null>(null);
    const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        await postBlog(titleRef.current?.value || '', descriptionRef.current?.value || '');

        router.push('/');
        router.refresh();
    };

    return <>
  <div className="w-full m-auto flex my-4">
    <div className="flex flex-col justify-center items-center m-auto">
      <p className="text-2xl text-slate-200 font-bold p-3">ブログ新規作成 🚀</p>
      {isLoading && (
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin my-2" />
      )}
      <form onSubmit={handleSubmit}>
        <input
        ref={titleRef}
          placeholder="タイトルを入力"
          type="text"
          style={{ backgroundColor: "#ffffff" }}
          className="rounded-md px-4 w-full py-2 my-2"
        />
        <textarea
          ref={descriptionRef}
          placeholder="記事詳細を入力"
          style={{ backgroundColor: "#ffffff" }}
          className="rounded-md px-4 py-2 w-full my-2"
        ></textarea>
        <button
          type="submit"
          style={{ backgroundColor: "#e2e8f0" }}
          className="font-semibold px-4 py-2 shadow-xl rounded-lg m-auto cursor-pointer"
        >
          投稿
        </button>
      </form>
    </div>
  </div>
</>;
};

export default PostBlog;