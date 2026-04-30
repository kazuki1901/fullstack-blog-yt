'use client';
import React, { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';

const fetchPost = async (id: string) => {
  const res = await fetch(`/api/blog/${id}`, { cache: 'no-store' });
  return res.json();
};

const updatePost = async (id: string, title: string, description: string) => {
  const res = await fetch(`/api/blog/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title, description }),
    headers: { 'Content-Type': 'application/json' },
  });
  return res.json();
};

const deletePost = async (id: string) => {
  const res = await fetch(`/api/blog/${id}`, { method: 'DELETE' });
  return res.json();
};

const EditPost = ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = use(params);
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isFetching, setIsFetching] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await fetchPost(id);
      if (data?.post) {
        setTitle(data.post.title ?? '');
        setDescription(data.post.description ?? '');
      }
      setIsFetching(false);
    })();
  }, [id]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await updatePost(id, title, description);
    router.push('/');
    router.refresh();
  };

  const handleDelete = async () => {
    if (!confirm('本当に削除しますか?')) return;
    setIsSubmitting(true);
    await deletePost(id);
    router.push('/');
    router.refresh();
  };

  return (
    <div className="w-full m-auto flex my-4">
      <div className="flex flex-col justify-center items-center m-auto">
        <p className="text-2xl text-slate-200 font-bold p-3">ブログの編集 🚀</p>

        {(isFetching || isSubmitting) && (
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin my-2" />
        )}

        {!isFetching && (
          <form onSubmit={handleUpdate}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="タイトルを入力"
              type="text"
              style={{ backgroundColor: '#ffffff' }}
              className="rounded-md px-4 w-full py-2 my-2"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="記事詳細を入力"
              style={{ backgroundColor: '#ffffff' }}
              className="rounded-md px-4 py-2 w-full my-2"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="font-semibold px-4 py-2 mr-2 shadow-xl rounded-lg cursor-pointer bg-slate-200 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              更新
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSubmitting}
              className="font-semibold px-4 py-2 shadow-xl rounded-lg cursor-pointer bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              削除
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default EditPost;
