"use client";

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import {
  Settings,
  MessageSquareText,
  Home,
  BookOpen,
  Shield,
  Send,
  ThumbsDown,
  Edit,
  CheckCircle,
  Circle,
  RefreshCw,
  MessageSquare,
  Lightbulb,
} from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import Link from "next/link"
import { SidebarRedesign } from "@/components-redesign/sidebar-redesign"

export default function RedesignPage() {
  const [selectedEmail, setSelectedEmail] = useState<any>(null)
  const [editingReply, setEditingReply] = useState(false)

  // Sample email data
  const unansweredEmails = [
    {
      id: 1,
      subject: "Question about my subscription",
      sender: "john.doe@example.com",
      preview:
        "I recently signed up for your service and I have a question about how to cancel my subscription. Can you please guide me through the process?",
      time: "10:23 AM",
      unread: true,
      extractedQuestions: ["How do I cancel my subscription?"],
      hasMatchingFAQ: true,
    },
    {
      id: 2,
      subject: "Billing issue with my account",
      sender: "sarah.smith@example.com",
      preview:
        "I was charged twice for my monthly subscription and I would like to get a refund for the duplicate charge. Please help me resolve this issue.",
      time: "Yesterday",
      unread: true,
      extractedQuestions: ["Why was I charged twice?", "How can I get a refund?"],
      hasMatchingFAQ: false,
    },
  ]

  const readyEmails = [
    {
      id: 4,
      subject: "Need help with password reset",
      sender: "alex.wilson@example.com",
      preview:
        "I forgot my password and can't seem to reset it. The reset link in the email doesn't work. Can you help me reset my password?",
      time: "11:45 AM",
      unread: true,
      hasReply: true,
      extractedQuestions: ["How do I reset my password?", "Why doesn't the reset link work?"],
      hasMatchingFAQ: true,
      suggestedReply: `Dear Alex,

Thank you for reaching out to our support team.

To reset your password, please follow these steps:
1. Go to the login page
2. Click on "Forgot Password"
3. Enter your email address
4. Follow the instructions in the email you receive

If the reset link isn't working, it may have expired. Please request a new password reset link and try again within 30 minutes of receiving the email.

If you continue to experience issues, please let us know and we'll assist you further.

Best regards,
Support Team`,
    },
  ]

  // FAQ data
  const faqLibrary = [
    {
      id: 1,
      question: "How do I cancel my subscription?",
      answer:
        "You can cancel your subscription at any time from your account settings. Once canceled, you will still have access to the service until the end of your billing period.",
    },
    {
      id: 2,
      question: "How to reset your password",
      answer:
        "To reset your password, please click on the 'Forgot Password' link on the login page. You will receive an email with instructions to create a new password.",
    },
  ]

  // Function to generate a reply based on FAQ
  const generateReplyFromFAQ = (email: any) => {
    if (!email.hasMatchingFAQ) return null

    let matchingFAQ
    if (email.extractedQuestions[0].toLowerCase().includes("cancel")) {
      matchingFAQ = faqLibrary.find((faq) => faq.question.toLowerCase().includes("cancel"))
    } else if (email.extractedQuestions[0].toLowerCase().includes("password")) {
      matchingFAQ = faqLibrary.find((faq) => faq.question.toLowerCase().includes("password"))
    }

    if (!matchingFAQ) return null

    return `Dear ${email.sender
      .split("@")[0]
      .split(".")
      .map((name: string) => name.charAt(0).toUpperCase() + name.slice(1))
      .join(" ")},

Thank you for reaching out to our support team.

${matchingFAQ.answer}

If you have any further questions, please don't hesitate to contact us.

Best regards,
Support Team`
  }

  // Function to handle generating a reply
  const handleGenerateReply = () => {
    if (!selectedEmail) return

    const generatedReply = generateReplyFromFAQ(selectedEmail)
    if (generatedReply) {
      // Update the selected email to include the suggested reply
      setSelectedEmail({
        ...selectedEmail,
        hasReply: true,
        suggestedReply: generatedReply,
      })
    }
  }

  // Email list component
  const EmailList = ({ emails }: { emails: any[] }) => (
    <div className="space-y-3">
      {emails.map((email) => (
        <div
          key={email.id}
          className={`p-5 rounded-xl cursor-pointer transition-all shadow-sm hover:shadow-md ${
            selectedEmail?.id === email.id
              ? "bg-white border-l-4 border-indigo-600"
              : "hover:bg-white border-l-4 border-transparent"
          } ${email.unread ? "font-medium" : ""}`}
          onClick={() => setSelectedEmail(email)}
        >
          <div className="flex gap-3">
            <Avatar className="h-10 w-10 mt-1">
              <AvatarFallback className="bg-blue-100 text-indigo-600">
                {email.sender.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-base font-medium truncate flex-1 text-gray-800">{email.subject}</h3>
                <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{email.time}</span>
              </div>
              <div className="text-sm text-gray-600 mb-1 truncate">{email.sender}</div>
              <p className="text-sm text-gray-500 line-clamp-2">{email.preview}</p>
              <div className="flex justify-between items-center mt-2">
                <div className="flex items-center gap-2">
                  {email.unread ? (
                    <Badge className="bg-indigo-50 text-indigo-600 hover:bg-indigo-50 px-2 rounded-full font-normal">
                      New
                    </Badge>
                  ) : null}
                  {email.hasReply ? (
                    <Badge className="bg-green-50 text-green-700 hover:bg-green-50 px-2 rounded-full font-normal">
                      Ready to reply
                    </Badge>
                  ) : null}
                  {email.hasMatchingFAQ ? (
                    <Badge className="bg-indigo-50 text-indigo-600 hover:bg-indigo-50 px-2 rounded-full font-normal">
                      FAQ Match
                    </Badge>
                  ) : null}
                </div>
                <div>
                  {email.answered ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <Circle className="h-4 w-4 text-gray-300" />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )

  // Email detail component
  const EmailDetail = ({ email, showReply = false }: { email: any; showReply?: boolean }) => {
    const [quickReply, setQuickReply] = useState("")

    // Customer data that would come from Stripe
    const customerData = {
      name: "John Doe",
      email: email.sender,
      subscription: "Premium Plan",
      status: "Active",
      since: "Jan 2023",
      billingCycle: "Monthly",
      nextBilling: "Aug 15, 2023",
    }

    return (
      <div className="p-8 h-full flex flex-col max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
              <AvatarFallback className="bg-blue-100 text-indigo-600 text-lg">
                {email.sender.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-gray-800">
                  {email.sender
                    .split("@")[0]
                    .split(".")
                    .map((name: string) => name.charAt(0).toUpperCase() + name.slice(1))
                    .join(" ")}
                </span>
                <span className="text-sm text-gray-500">&lt;{email.sender}&gt;</span>
                <span className="text-xs text-gray-400 ml-auto">{email.time}</span>
              </div>
              <div className="text-sm text-gray-500">to me</div>
            </div>
          </div>

          <h2 className="text-2xl font-semibold mb-6 text-gray-900">{email.subject}</h2>

          <div className="flex flex-wrap gap-2 mb-6">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all"
                >
                  <svg className="h-4 w-4 mr-1" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M32 13.414v5.172L28.414 22H3.586L0 18.586v-5.172L3.586 10h24.828L32 13.414z"
                      fill="#6772e5"
                    />
                    <path d="M21.5 20.5h-11v-9h11v9zm-7-3h4v-3h-4v3z" fill="#6772e5" />
                  </svg>
                  Customer Info
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl border-0 shadow-lg p-0 overflow-hidden">
                <DialogHeader className="bg-indigo-600 text-white p-6">
                  <DialogTitle className="text-xl font-medium">Customer Information</DialogTitle>
                </DialogHeader>
                <div className="p-6">
                  <div className="flex items-center gap-4 mb-8">
                    <Avatar className="h-16 w-16 border-4 border-white shadow-md -mt-12">
                      <AvatarFallback className="bg-blue-100 text-indigo-600 text-lg">
                        {customerData.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-lg">{customerData.name}</div>
                      <div className="text-sm text-gray-500">{customerData.email}</div>
                    </div>
                  </div>
                  <div className="space-y-5">
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Plan</span>
                      <span className="text-gray-900">{customerData.subscription}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Status</span>
                      <Badge className="bg-green-50 text-green-700 rounded-full px-3 py-0.5">
                        {customerData.status}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Customer since</span>
                      <span className="text-gray-900">{customerData.since}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Billing cycle</span>
                      <span className="text-gray-900">{customerData.billingCycle}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-b border-gray-100">
                      <span className="text-gray-600 font-medium">Next billing</span>
                      <span className="text-gray-900">{customerData.nextBilling}</span>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all"
              onClick={() => handleGenerateReply()}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all ml-auto"
            >
              <ThumbsDown className="h-4 w-4 mr-1" />
              Not Relevant
            </Button>
          </div>
        </div>

        <Card className="mb-8 rounded-2xl border-0 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
          <CardContent className="p-8 bg-white">
            <p className="text-base text-gray-800 leading-relaxed">
              Hello Support Team,
              <br />
              <br />
              {email.preview}
              <br />
              <br />
              Thank you,
              <br />
              {email.sender
                .split("@")[0]
                .split(".")
                .map((name: string) => name.charAt(0).toUpperCase() + name.slice(1))
                .join(" ")}
            </p>
          </CardContent>
        </Card>

        {email.extractedQuestions && email.extractedQuestions.length > 0 && (
          <div className="mb-8">
            <h3 className="text-base font-medium mb-3 flex items-center text-gray-800">
              <Lightbulb className="h-4 w-4 mr-2 text-amber-500" />
              Extracted Questions
            </h3>
            <div className="space-y-2">
              {email.extractedQuestions.map((question: string, index: number) => (
                <div key={index} className="bg-indigo-50 p-4 rounded-xl text-indigo-800 shadow-sm">
                  {question}
                  {email.hasMatchingFAQ && index === 0 && (
                    <Badge className="ml-2 bg-indigo-100 text-indigo-700 hover:bg-indigo-100 rounded-full">
                      FAQ Match Available
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Reply Section */}
        <div className="mt-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-medium text-gray-800">Quick Reply</h3>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all"
              disabled={!quickReply.trim()}
            >
              <Send className="h-3 w-3 mr-1" />
              Send
            </Button>
          </div>
          <Textarea
            placeholder="Type a quick reply..."
            className="min-h-[100px] rounded-xl border-gray-200 resize-none focus:ring-indigo-600 focus:border-indigo-600"
            value={quickReply}
            onChange={(e) => setQuickReply(e.target.value)}
          />
        </div>

        {(showReply || email.hasReply) && (
          <div className="mt-8">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-base font-medium flex items-center text-gray-800">
                <MessageSquare className="h-4 w-4 mr-2 text-green-600" />
                Suggested Reply
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingReply(!editingReply)}
                className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-full"
              >
                <Edit className="h-4 w-4 mr-1" />
                {editingReply ? "Cancel Edit" : "Edit Reply"}
              </Button>
            </div>

            {editingReply ? (
              <div className="space-y-3">
                <Textarea
                  className="min-h-[200px] rounded-xl border-gray-200 resize-none focus:ring-indigo-600 focus:border-indigo-600"
                  defaultValue={
                    email.suggestedReply ||
                    `Dear ${email.sender
                      .split("@")[0]
                      .split(".")
                      .map((name: string) => name.charAt(0).toUpperCase() + name.slice(1))
                      .join(" ")},

Thank you for reaching out to our support team.

${email.hasMatchingFAQ && email.extractedQuestions[0] ? 
  faqLibrary.find((faq) => faq.question.toLowerCase().includes(email.extractedQuestions[0].toLowerCase().split(" ").pop() || ''))?.answer || 
  "I'll look into this issue for you right away." : 
  "I'll look into this issue for you right away."}

If you have any further questions, please don't hesitate to contact us.

Best regards,
Support Team`
                  }
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" className="rounded-full">
                    Cancel
                  </Button>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all">
                    <Send className="h-4 w-4 mr-2" />
                    Send Reply
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border rounded-xl p-6 bg-white shadow-sm hover:shadow-md transition-all">
                <p className="text-base text-gray-800 leading-relaxed whitespace-pre-line">
                  {email.suggestedReply ||
                    `Dear ${email.sender
                      .split("@")[0]
                      .split(".")
                      .map((name: string) => name.charAt(0).toUpperCase() + name.slice(1))
                      .join(" ")},

Thank you for reaching out to our support team.

${email.hasMatchingFAQ && email.extractedQuestions[0] ? 
  faqLibrary.find((faq) => faq.question.toLowerCase().includes(email.extractedQuestions[0].toLowerCase().split(" ").pop() || ''))?.answer || 
  "I'll look into this issue for you right away." : 
  "I'll look into this issue for you right away."}

If you have any further questions, please don't hesitate to contact us.

Best regards,
Support Team`}
                </p>
                <div className="flex justify-end mt-4">
                  <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all">
                    <Send className="h-4 w-4 mr-2" />
                    Send Reply
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // FAQ Library content
  const FAQLibraryContent = () => (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8 flex justify-between items-center">
          <h2 className="text-2xl font-semibold text-gray-900">FAQ Knowledge Base</h2>
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all">
            Add New FAQ
          </Button>
        </div>

        <div className="grid gap-6">
          {faqLibrary.map((faq) => (
            <Card
              key={faq.id}
              className="rounded-2xl border-0 shadow-sm hover:shadow-md transition-all overflow-hidden"
            >
              <CardHeader className="pb-2 p-6 bg-white">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg font-medium text-gray-800">{faq.question}</CardTitle>
                  <Badge className="bg-green-50 text-green-700 hover:bg-green-50 rounded-full px-3 py-0.5">
                    Active
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-2 bg-white">
                <p className="text-base text-gray-600 leading-relaxed">{faq.answer}</p>
                <div className="flex justify-end mt-4 space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full text-indigo-600 border-indigo-100 hover:bg-indigo-50 hover:border-indigo-200"
                  >
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-50">
      <SidebarRedesign />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm px-8 py-5 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">FAQ Auto Reply</h1>
            <p className="text-sm text-gray-500 mt-1">Automatically match and reply to customer support emails</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full border-gray-200 shadow-sm hover:shadow hover:border-gray-300 transition-all"
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow rounded-full transition-all"
            >
              Refresh
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="unanswered" className="h-full flex flex-col">
            <div className="px-8 pt-6">
              <TabsList className="bg-transparent border-b border-gray-200 w-full max-w-4xl p-0 h-auto">
                <TabsTrigger
                  value="unanswered"
                  className="px-6 py-3 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Unanswered
                </TabsTrigger>
                <TabsTrigger
                  value="ready"
                  className="px-6 py-3 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Ready to Reply
                </TabsTrigger>
                <TabsTrigger
                  value="faq"
                  className="px-6 py-3 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  FAQ Library
                </TabsTrigger>
                <TabsTrigger
                  value="not-relevant"
                  className="px-6 py-3 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Not Relevant
                </TabsTrigger>
                <TabsTrigger
                  value="answered"
                  className="px-6 py-3 rounded-t-2xl data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all border-b-2 border-transparent data-[state=active]:border-indigo-600 text-gray-600 hover:text-gray-900"
                >
                  Answered
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden mt-6">
              <TabsContent value="unanswered" className="h-full flex data-[state=active]:flex-row">
                <div className="w-1/3 border-r border-gray-100 overflow-y-auto p-4">
                  <div className="mb-4" />
                  <EmailList emails={unansweredEmails} />
                </div>
                <div className="w-2/3 overflow-y-auto">
                  {selectedEmail ? (
                    <EmailDetail email={selectedEmail} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                        <p className="text-lg">Select an email to view details</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ready" className="h-full data-[state=active]:flex flex-row">
                <div className="w-1/3 border-r border-gray-100 overflow-y-auto p-4">
                  <div className="mb-4" />
                  <EmailList emails={readyEmails} />
                </div>
                <div className="w-2/3 overflow-y-auto">
                  {selectedEmail ? (
                    <EmailDetail email={selectedEmail} showReply={true} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <MessageSquareText className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                        <p className="text-lg">Select an email to view details</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="faq" className="h-full overflow-y-auto">
                <FAQLibraryContent />
              </TabsContent>

              <TabsContent value="not-relevant" className="h-full data-[state=active]:flex flex-row">
                <div className="w-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <ThumbsDown className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                    <p className="text-lg">No emails marked as not relevant</p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="answered" className="h-full data-[state=active]:flex flex-row">
                <div className="w-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <CheckCircle className="h-12 w-12 mx-auto text-gray-200 mb-4" />
                    <p className="text-lg">No answered emails</p>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
} 