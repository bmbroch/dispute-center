export const TINYMCE_CONFIG = {
  height: 400,
  menubar: false,
  statusbar: false,
  branding: false,
  promotion: false,
  toolbar_sticky: true,
  removed_menuitems: 'newdocument',
  elementpath: false,
  skin: 'oxide',
  plugins: [
    'advlist', 'autolink', 'lists', 'link', 'image',
    'charmap', 'preview', 'anchor', 'searchreplace',
    'visualblocks', 'code', 'fullscreen',
    'insertdatetime', 'media', 'table', 'help',
    'wordcount'
  ],
  toolbar: 'undo redo | formatselect | ' +
    'bold italic underline | alignleft aligncenter ' +
    'alignright alignjustify | bullist numlist | ' +
    'link image | removeformat',
  paste_data_images: true,
  paste_as_text: false,
  paste_enable_default_filters: true,
  paste_word_valid_elements: 'b,strong,i,em,h1,h2,h3,p,br',
  paste_webkit_styles: 'none',
  paste_retain_style_properties: 'none',
  paste_merge_formats: true,
  paste_convert_word_fake_lists: true,
  automatic_uploads: true,
  content_style: `
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      padding: 1rem;
      color: #000000;
      background: #ffffff;
    }
    p { margin: 0 0 1em 0; }
    img { 
      max-width: 40%; 
      height: auto;
      display: block;
      margin: 8px 0;
    }
  `,
  setup: function(editor: any) {
    editor.on('init', function() {
      const body = editor.getBody();
      body.style.backgroundColor = '#ffffff';
      body.style.color = '#000000';
    });
  },
  image_dimensions: false,
  image_class_list: [
    {title: 'Default (40%)', value: 'default-image'},
    {title: 'Full width', value: 'full-width'}
  ],
  image_default_size: {
    width: '40%',
    height: 'auto'
  },
  images_upload_handler: async function (blobInfo: any) {
    try {
      // Convert the blob to base64
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
        reader.readAsDataURL(blobInfo.blob());
      });
    } catch (error) {
      console.error('Failed to upload image:', error);
      throw error;
    }
  }
}; 