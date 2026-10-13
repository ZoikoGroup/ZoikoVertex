import { describe, it, expect, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import PublishedContentPanel, { platformKey, type PublishedContentItem } from '../PublishedContentPanel';

beforeAll(() => {
  // jsdom has no matchMedia; the Popover reads it for reduced-motion.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

const post = (id: string, platform: string | null, content: string): PublishedContentItem => ({
  id,
  source: 'publish',
  platform,
  content,
  mediaUrl: null,
  status: 'PUBLISHED',
  createdAt: new Date().toISOString(),
  scheduledTime: null,
  agentName: null,
  check: null,
});

const data = [
  post('1', 'threads', 'thread one'),
  post('2', 'THREADS', 'thread two'),
  post('3', 'linkedin_personal', 'linkedin post'),
  post('4', 'youtube', 'yt video'),
  post('5', 'instagram', 'insta reel'),
];

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /filter posts by platform/i }));

describe('platformKey', () => {
  it('normalises case, suffixes and aliases', () => {
    expect(platformKey('Threads')).toBe('threads');
    expect(platformKey('linkedin_personal')).toBe('linkedin');
    expect(platformKey('x')).toBe('twitter');
    expect(platformKey('yt')).toBe('youtube');
    expect(platformKey(null)).toBe('other');
  });
});

describe('PublishedContentPanel platform filter', () => {
  it('shows every post and the total by default', () => {
    render(<PublishedContentPanel data={data} />);
    expect(screen.getByText('5 items')).toBeDefined();
    expect(screen.getByText('thread one')).toBeDefined();
    expect(screen.getByText('yt video')).toBeDefined();
  });

  it('lists each platform with its post count and disables empty ones', () => {
    render(<PublishedContentPanel data={data} />);
    openMenu();
    const threads = screen.getByRole('menuitemradio', { name: /threads/i });
    expect(threads.textContent).toContain('2');
    const facebook = screen.getByRole('menuitemradio', { name: /facebook/i }) as HTMLButtonElement;
    expect(facebook.disabled).toBe(true);
  });

  it('filters to the chosen platform and can reset to all', () => {
    render(<PublishedContentPanel data={data} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /threads/i }));
    expect(screen.getByText('2 of 5 items')).toBeDefined();
    expect(screen.getByText('thread one')).toBeDefined();
    expect(screen.getByText('thread two')).toBeDefined();
    expect(screen.queryByText('linkedin post')).toBeNull();
    expect(screen.queryByText('yt video')).toBeNull();

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /linkedin/i }));
    expect(screen.getByText('1 of 5 items')).toBeDefined();
    expect(screen.getByText('linkedin post')).toBeDefined();

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /all platforms/i }));
    expect(screen.getByText('5 items')).toBeDefined();
  });

  it('offers a way back when the chosen platform has no posts left', () => {
    const { rerender } = render(<PublishedContentPanel data={data} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /youtube/i }));
    rerender(<PublishedContentPanel data={data.filter((p) => p.platform !== 'youtube')} />);
    expect(screen.getByText(/no youtube posts yet/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /show all platforms/i }));
    expect(screen.getByText('4 items')).toBeDefined();
  });
});
