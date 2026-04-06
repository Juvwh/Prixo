import Masonry from 'react-masonry-css';
import ItemCard from './ItemCard';

export default function MasonryGrid({ items, user }) {
  const breakpointColumnsObj = {
    default: 4,
    1536: 4,
    1280: 3,
    1024: 2,
    768: 2,
    640: 1
  };

  return (
    <Masonry
      breakpointCols={breakpointColumnsObj}
      className="flex w-auto -ml-6"
      columnClassName="pl-6 bg-clip-padding"
    >
      {items.map(item => (
        <div key={item.id} className="mb-6">
          <ItemCard item={item} user={user} />
        </div>
      ))}
    </Masonry>
  );
}
