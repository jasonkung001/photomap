/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import EXIF from 'exif-js';
import { 
  Image as ImageIcon, 
  MapPin, 
  Upload, 
  Trash2, 
  Play, 
  Calendar, 
  ChevronRight, 
  ChevronLeft,
  Loader2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from './lib/utils';
import { PhotoMetadata, generatePhotoAnimation } from './services/geminiService';

// Fix Leaflet icon issue
const fixLeafletIcons = () => {
  if (typeof window === 'undefined') return;
  
  try {
    // Manually define the icon to avoid path issues
    const defaultIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });
    L.Marker.prototype.options.icon = defaultIcon;
  } catch (e) {
    console.error('Failed to fix Leaflet icons', e);
  }
};

// Component to handle map focus
function MapFocus({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, 13, { animate: true });
    }
  }, [center, map]);
  return null;
}

export default function App() {
  const [photos, setPhotos] = useState<PhotoMetadata[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoMetadata | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnimating, setIsAnimating] = useState<string | null>(null); // photo ID
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc'>('date-desc');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Leaflet icons
  useEffect(() => {
    fixLeafletIcons();
  }, []);

  // Load photos and search history from localStorage
  useEffect(() => {
    const savedPhotos = localStorage.getItem('photomap_memories');
    if (savedPhotos) {
      try {
        const parsed = JSON.parse(savedPhotos);
        if (Array.isArray(parsed)) {
          // Filter out invalid entries
          const validPhotos = parsed.filter(p => 
            p && typeof p === 'object' && 
            typeof p.lat === 'number' && !isNaN(p.lat) &&
            typeof p.lng === 'number' && !isNaN(p.lng)
          );
          setPhotos(validPhotos);
        }
      } catch (e) {
        console.error('Failed to parse saved photos', e);
      }
    }

    const savedHistory = localStorage.getItem('photomap_search_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed)) {
          setSearchHistory(parsed.filter(h => typeof h === 'string'));
        }
      } catch (e) {
        console.error('Failed to parse search history', e);
      }
    }
  }, []);

  // Save photos to localStorage with error handling
  useEffect(() => {
    try {
      localStorage.setItem('photomap_memories', JSON.stringify(photos));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        setError('儲存空間已滿。請刪除一些舊相片後再試，或上傳較小的檔案。');
      }
    }
  }, [photos]);

  // Save search history to localStorage with error handling
  useEffect(() => {
    try {
      localStorage.setItem('photomap_search_history', JSON.stringify(searchHistory));
    } catch (e) {
      console.error('Failed to save search history', e);
    }
  }, [searchHistory]);

  const filteredPhotos = useMemo(() => {
    const sorted = [...photos].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return sortBy === 'date-desc' ? dateB - dateA : dateA - dateB;
    });

    if (!searchTerm) return sorted;

    return sorted.filter(photo => 
      photo.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [photos, sortBy, searchTerm]);

  const resizeImage = (base64: string, maxWidth = 1200, maxHeight = 1200): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7)); // Compress to JPEG 0.7 quality
      };
    });
  };

  const processFile = async (file: File): Promise<PhotoMetadata | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const originalBase64 = event.target?.result as string;
        const base64 = await resizeImage(originalBase64);
        
        // Extract EXIF
        EXIF.getData(file as any, function(this: any) {
          const allMetadata = EXIF.getAllTags(this);
          
          let lat = 0;
          let lng = 0;
          let date = new Date().toISOString();

          if (allMetadata.GPSLatitude && allMetadata.GPSLongitude) {
            const latRef = allMetadata.GPSLatitudeRef || 'N';
            const lngRef = allMetadata.GPSLongitudeRef || 'E';
            
            const parseGPS = (gps: any) => {
              if (!gps || !Array.isArray(gps) || gps.length < 3) return 0;
              const d = (gps[0].numerator || 0) / (gps[0].denominator || 1);
              const m = (gps[1].numerator || 0) / (gps[1].denominator || 1);
              const s = (gps[2].numerator || 0) / (gps[2].denominator || 1);
              return d + m / 60 + s / 3600;
            };

            lat = parseGPS(allMetadata.GPSLatitude);
            if (latRef === 'S') lat = -lat;

            lng = parseGPS(allMetadata.GPSLongitude);
            if (lngRef === 'W') lng = -lng;
            
            if (isNaN(lat) || isNaN(lng)) {
              lat = 25.0330 + (Math.random() - 0.5) * 0.1;
              lng = 121.5654 + (Math.random() - 0.5) * 0.1;
            }
          } else {
            lat = 25.0330 + (Math.random() - 0.5) * 0.1;
            lng = 121.5654 + (Math.random() - 0.5) * 0.1;
          }

          if (allMetadata.DateTimeOriginal) {
            try {
              const parts = allMetadata.DateTimeOriginal.split(' ');
              const dateParts = parts[0].split(':');
              const timeParts = parts[1].split(':');
              date = new Date(
                parseInt(dateParts[0]),
                parseInt(dateParts[1]) - 1,
                parseInt(dateParts[2]),
                parseInt(timeParts[0]),
                parseInt(timeParts[1]),
                parseInt(timeParts[2])
              ).toISOString();
            } catch (e) {
              date = new Date().toISOString();
            }
          }

          resolve({
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            date,
            lat,
            lng,
            base64,
          });
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const newPhotos: PhotoMetadata[] = [];
    
    for (let i = 0; i < files.length; i++) {
      const photo = await processFile(files[i]);
      if (photo) newPhotos.push(photo);
    }

    if (newPhotos.length > 0) {
      setPhotos(prev => [...prev, ...newPhotos]);
      setMapCenter([newPhotos[0].lat, newPhotos[0].lng]);
    }
    
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const deletePhoto = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPhotos(prev => prev.filter(p => p.id !== id));
    if (selectedPhoto?.id === id) setSelectedPhoto(null);
  };

  const handleAnimate = async (photo: PhotoMetadata, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAnimating) return;
    
    setIsAnimating(photo.id);
    try {
      const animationUrl = await generatePhotoAnimation(photo.base64);
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, animationUrl } : p));
    } catch (err: any) {
      console.error('Animation failed', err);
      setError('動畫生成失敗。這可能是由於網路問題或 AI 服務暫時不可用，請稍後再試。');
      setSelectedPhoto(null); // Jump back to original screen (map/list)
    } finally {
      setIsAnimating(null);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim() && !searchHistory.includes(searchTerm.trim())) {
      setSearchHistory(prev => [searchTerm.trim(), ...prev].slice(0, 8));
    }
  };

  const removeHistoryItem = (item: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchHistory(prev => prev.filter(h => h !== item));
  };

  return (
    <div className="flex h-screen bg-[#F5F5F0] text-[#141414] font-sans overflow-hidden">
      {/* Sidebar - Photo Management */}
      <div className="w-96 flex flex-col border-r border-[#141414]/10 bg-white shadow-xl z-20">
        <header className="p-6 border-b border-[#141414]/10 space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <MapPin className="w-6 h-6 text-emerald-600" />
              記憶地圖
            </h1>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="p-2 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept="image/*" 
              multiple
              className="hidden" 
            />
          </div>

          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              placeholder="搜尋相片名稱..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-4 pr-10 py-2 bg-[#F5F5F0] rounded-xl border border-transparent focus:border-emerald-600 focus:bg-white transition-all outline-none text-sm"
            />
            {searchTerm && (
              <button 
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#141414]/40 hover:text-[#141414]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </form>

          {searchHistory.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {searchHistory.map((item) => (
                <button
                  key={item}
                  onClick={() => setSearchTerm(item)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border",
                    searchTerm === item 
                      ? "bg-emerald-600 text-white border-emerald-600" 
                      : "bg-[#F5F5F0] text-[#141414]/60 border-transparent hover:border-[#141414]/20"
                  )}
                >
                  {item}
                  <X 
                    className="w-3 h-3 hover:text-red-500" 
                    onClick={(e) => removeHistoryItem(item, e)}
                  />
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 text-sm font-medium text-[#141414]/60">
            <button 
              onClick={() => setSortBy(sortBy === 'date-desc' ? 'date-asc' : 'date-desc')}
              className="flex items-center gap-1 hover:text-[#141414] transition-colors"
            >
              <Calendar className="w-4 h-4" />
              {sortBy === 'date-desc' ? '最新優先' : '最舊優先'}
            </button>
            <span className="ml-auto">{filteredPhotos.length} 張相片</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {filteredPhotos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#141414]/40 text-center">
              <ImageIcon className="w-12 h-12 mb-2 opacity-20" />
              <p>{searchTerm ? '找不到符合的相片' : '尚未上傳相片'}<br/>{searchTerm ? '請嘗試其他關鍵字' : '點擊上方按鈕開始記錄'}</p>
            </div>
          ) : (
            filteredPhotos.map((photo) => (
              <motion.div
                key={photo.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => {
                  setSelectedPhoto(photo);
                  setMapCenter([photo.lat, photo.lng]);
                }}
                className={cn(
                  "group relative rounded-2xl border border-transparent bg-[#F5F5F0] p-3 cursor-pointer transition-all hover:shadow-md",
                  selectedPhoto?.id === photo.id && "border-emerald-600 bg-emerald-50 shadow-md"
                )}
              >
                <div className="flex gap-4">
                  <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                    <img 
                      src={photo.base64} 
                      alt={photo.name} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <h3 className="font-semibold truncate text-sm">{photo.name}</h3>
                    <p className="text-xs text-[#141414]/60 mt-1">{formatDate(photo.date)}</p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => handleAnimate(photo, e)}
                        disabled={isAnimating === photo.id}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-white px-2 py-1 rounded-full border border-[#141414]/10 hover:bg-emerald-600 hover:text-white transition-all disabled:opacity-50"
                      >
                        {isAnimating === photo.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        動起來
                      </button>
                      <button
                        onClick={(e) => deletePhoto(photo.id, e)}
                        className="p-1 text-[#141414]/40 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      {/* Main Content - Map */}
      <div className="flex-1 relative">
        <MapContainer 
          center={[25.0330, 121.5654]} 
          zoom={13} 
          className="w-full h-full grayscale-[0.2] contrast-[1.1]"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {filteredPhotos.map((photo) => (
            <Marker 
              key={photo.id} 
              position={[photo.lat, photo.lng]}
              eventHandlers={{
                click: () => setSelectedPhoto(photo),
              }}
            >
              <Popup>
                <div className="p-1 w-40">
                  <img 
                    src={photo.base64} 
                    alt={photo.name} 
                    className="w-full h-24 object-cover rounded-lg mb-2"
                    referrerPolicy="no-referrer"
                  />
                  <p className="text-xs font-bold truncate">{photo.name}</p>
                  <p className="text-[10px] text-gray-500">{formatDate(photo.date)}</p>
                </div>
              </Popup>
            </Marker>
          ))}
          <MapFocus center={mapCenter} />
        </MapContainer>

        {/* Error Modal */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
              >
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <X className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold mb-2">生成失敗</h3>
                <p className="text-[#141414]/60 text-sm mb-8">
                  {error}
                </p>
                <button
                  onClick={() => setError(null)}
                  className="w-full py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-[#141414]/80 transition-all"
                >
                  返回相片
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Photo Detail Overlay */}
        <AnimatePresence>
          {selectedPhoto && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden z-[1000] border border-[#141414]/10"
            >
              <div className="flex flex-col md:flex-row h-full">
                <div className="w-full md:w-1/2 aspect-square md:aspect-auto bg-black relative group">
                  {selectedPhoto.animationUrl ? (
                    <video 
                      src={selectedPhoto.animationUrl} 
                      autoPlay 
                      loop 
                      muted 
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img 
                      src={selectedPhoto.base64} 
                      alt={selectedPhoto.name} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="absolute top-4 left-4">
                    <span className="px-3 py-1 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest rounded-full">
                      {selectedPhoto.animationUrl ? 'AI 動畫' : '原始相片'}
                    </span>
                  </div>
                </div>
                <div className="w-full md:w-1/2 p-8 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h2 className="text-xl font-bold leading-tight">{selectedPhoto.name}</h2>
                      <p className="text-sm text-[#141414]/60 mt-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(selectedPhoto.date)}
                      </p>
                    </div>
                    <button 
                      onClick={() => setSelectedPhoto(null)}
                      className="p-2 hover:bg-[#F5F5F0] rounded-full transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="mt-auto space-y-4">
                    <div className="p-4 bg-[#F5F5F0] rounded-2xl">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-[#141414]/40 mb-2">地理位置</p>
                      <p className="text-xs font-mono">
                        LAT: {selectedPhoto.lat.toFixed(6)}<br/>
                        LNG: {selectedPhoto.lng.toFixed(6)}
                      </p>
                    </div>
                    
                    {!selectedPhoto.animationUrl && (
                      <button
                        onClick={(e) => handleAnimate(selectedPhoto, e)}
                        disabled={isAnimating === selectedPhoto.id}
                        className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all disabled:opacity-50"
                      >
                        {isAnimating === selectedPhoto.id ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            正在生成動畫...
                          </>
                        ) : (
                          <>
                            <Play className="w-5 h-5" />
                            生成 AI 動畫
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
