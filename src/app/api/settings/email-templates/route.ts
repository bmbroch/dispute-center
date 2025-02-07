import { NextRequest, NextResponse } from 'next/server';
import { collection, doc, getDocs, setDoc, deleteDoc, query, where, Firestore } from 'firebase/firestore';
import { getFirebaseDB } from '@/lib/firebase/firebase';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  order: number;
  userEmail?: string;
  updatedAt?: string;
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: '1',
    name: 'First Response',
    subject: 'Re: Dispute Resolution - Interview Sidekick',
    body: `Hi {{firstName}},\n\nI noticed you've opened a dispute for our service. I understand your concern and I'd like to help resolve this directly.\n\nOur records show that you've accessed our platform and we'd love to ensure you get the most value from it. Would you be open to discussing this before proceeding with the dispute?`,
    order: 1
  },
  {
    id: '2',
    name: 'Follow Up',
    subject: 'Re: Dispute Follow-up - Interview Sidekick',
    body: `Hi {{firstName}},\n\nI'm following up on the dispute you've filed. I noticed we haven't heard back from you yet. As a small business owner, I'm personally committed to ensuring every customer's satisfaction.\n\nWould you be willing to have a quick discussion about your concerns? We can also arrange for a refund through PayPal if you'd prefer that option?`,
    order: 2
  },
  {
    id: '3',
    name: 'Final Notice',
    subject: 'Re: Final Notice - Interview Sidekick Dispute',
    body: `Hi {{firstName}},\n\nThis is my final attempt to resolve this dispute amicably. As mentioned before, we have records of your platform usage and are prepared to provide this evidence if needed.\n\nHowever, I'd much prefer to resolve this directly with you. Please let me know if you'd be open to discussing this or accepting a refund through PayPal.`,
    order: 3
  }
];

export async function GET(request: NextRequest) {
  try {
    const userEmail = request.headers.get('x-user-email');
    if (!userEmail) {
      console.log('No user email provided, returning default templates');
      return NextResponse.json(DEFAULT_TEMPLATES);
    }

    try {
      const db = getFirebaseDB();
      if (!db) {
        console.warn('Failed to initialize Firebase, returning default templates');
        return NextResponse.json(DEFAULT_TEMPLATES);
      }

      // Create collection reference
      const templatesRef = collection(db, 'emailTemplates');
      const q = query(templatesRef, where('userEmail', '==', userEmail));
      
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        console.log('No custom templates found for user, returning defaults');
        return NextResponse.json(DEFAULT_TEMPLATES);
      }

      const templates = querySnapshot.docs.map(doc => {
        const data = doc.data() as EmailTemplate;
        return {
          id: data.id,
          name: data.name,
          subject: data.subject,
          body: data.body,
          order: data.order
        };
      }).sort((a, b) => a.order - b.order);

      return NextResponse.json(templates.length > 0 ? templates : DEFAULT_TEMPLATES);
    } catch (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json(DEFAULT_TEMPLATES);
    }
  } catch (error) {
    console.error('Error in GET handler:', error);
    return NextResponse.json(DEFAULT_TEMPLATES);
  }
}

export async function POST(request: NextRequest) {
  try {
    const userEmail = request.headers.get('x-user-email');
    if (!userEmail) {
      return NextResponse.json({ error: 'User email is required' }, { status: 400 });
    }

    const db = getFirebaseDB();
    if (!db) {
      throw new Error('Failed to initialize Firebase');
    }

    const body = await request.json();
    const templates = Array.isArray(body) ? body : [body];

    // Validate templates
    for (const template of templates) {
      if (!template.id || !template.name || !template.subject || !template.body) {
        return NextResponse.json({ 
          error: 'Invalid template format. Required fields: id, name, subject, body' 
        }, { status: 400 });
      }
    }

    // Create collection reference
    const templatesRef = collection(db, 'emailTemplates');

    // Delete existing templates for this user
    const q = query(templatesRef, where('userEmail', '==', userEmail));
    const querySnapshot = await getDocs(q);
    const deletePromises = querySnapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises);

    // Save new templates
    const savePromises = templates.map((template, index) => {
      const docRef = doc(templatesRef, `${userEmail}_${template.id}`);
      return setDoc(docRef, {
        ...template,
        userEmail,
        order: template.order || index + 1,
        updatedAt: new Date().toISOString()
      });
    });

    await Promise.all(savePromises);
    
    return NextResponse.json({ 
      success: true, 
      message: 'Templates saved successfully',
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        subject: t.subject,
        body: t.body,
        order: t.order
      }))
    });

  } catch (error) {
    console.error('Error in POST handler:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to save templates',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 